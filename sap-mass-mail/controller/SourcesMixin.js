sap.ui.define([
  "sap/ui/core/Fragment",
  "MAILING_CONSTRUCTOR/util/toast",
  "MAILING_CONSTRUCTOR/util/config",
  "MAILING_CONSTRUCTOR/util/sourceBlock",
  "MAILING_CONSTRUCTOR/util/fileProcessor",
  "MAILING_CONSTRUCTOR/util/sourceTypes",
  "MAILING_CONSTRUCTOR/model/formatter"
], (Fragment, Toast, Config, SourceBlock, FileProcessor,
    SourceTypes, Formatter) => {
  "use strict";

  /**
   * Maximum number of source files processed in parallel.
   * Enforced at the mixin-instance level so multiple drop events share
   * one worker budget (each source may spawn a pdfjs/docx worker).
   */
  const MAX_CONCURRENT_FILES = 2;

  return {

    onSourceChange(oEvent) {
      this._handleSourceDrop(oEvent.getParameter("files") || []);
    },

    onAttachmentDeleted(oEvent) {
      const oCtx = oEvent.getSource().getBindingContext("state");
      if (!oCtx) { return; }
      const sId = oCtx.getProperty("id");
      const aAttachments = (this._oState.getProperty("/attachments") || [])
        .filter((a) => a.id !== sId);
      this._oState.setProperty("/attachments", aAttachments);
      this._updateHeaderBadges();
    },

    /**
     * Handles one or more dropped files. Enforces the global concurrency
     * limit at the instance level (queue + active counter are created
     * lazily so the mixin stays plain-object friendly).
     */
    _handleSourceDrop(fileList) {
      const aFiles = Array.from(fileList || []);
      if (!aFiles.length) { return; }

      if (!Array.isArray(this._aSourceQueue))        { this._aSourceQueue = []; }
      if (typeof this._iActiveSources !== "number")  { this._iActiveSources = 0; }

      this._aSourceQueue = this._aSourceQueue.concat(aFiles);
      this._drainSourceQueue();
    },

    /**
     * Pumps the instance-level source queue, launching up to
     * MAX_CONCURRENT_FILES _processSingleSource calls in parallel.
     * Called from _handleSourceDrop (initial enqueue) and from each
     * worker's .then/.catch (slot freed). Idempotent — a no-op when
     * the queue is empty or the active cap is reached.
     *
     * @private
     */
    _drainSourceQueue() {
      while (this._aSourceQueue.length > 0 && this._iActiveSources < MAX_CONCURRENT_FILES) {
        const file = this._aSourceQueue.shift();
        this._iActiveSources++;
        this._processSingleSource(file)
          .then(() => {
            this._iActiveSources--;
            this._drainSourceQueue();
          })
          .catch((err) => {
            // PDF import cancellation is a deliberate user action
            // (onPdfModeCancel) — don't toast it. Everything else is
            // a real processing failure worth surfacing.
            if (err && err.message && err.message !== "PDF import cancelled") {
              Toast.warning(err.message);
            }
            this._iActiveSources--;
            this._drainSourceQueue();
          });
      }
    },

    _processSingleSource(file) {
      const sExt = Config.getFileExt(file.name);
      const sSourceId = Config.generateSourceId();
      const oBundle = this._getBundle();

      if (file.size > Config.MAX_SOURCE_SIZE) {
        return Promise.reject(new Error(this._t("MSG_FILE_TOO_LARGE", [file.name])));
      }
      if (!Config.mimeMatchesExt(sExt, file.type)) {
        Toast.warning(this._t("MSG_MIME_MISMATCH", [file.name, file.type]));
      }

      if (sExt === ".pdf") {
        return this._promptPdfMode(file.name)
          .then((sMode) => FileProcessor.process(file, sSourceId, sMode, oBundle))
          .then((sHtml) => this._finalizeSource(sHtml, sSourceId, sExt, file.name));
      }
      return FileProcessor.process(file, sSourceId, null, oBundle)
        .then((sHtml) => this._finalizeSource(sHtml, sSourceId, sExt, file.name));
    },

    _finalizeSource(sHtml, sSourceId, sExt, sName) {
      this._oEditor.insert(sHtml);
      this._addSourceToList(sSourceId, SourceBlock.TYPE.FILE, sName);
    },

    /**
     * Opens the PDF-mode picker (text vs images) and resolves with the
     * chosen mode. Caches the dialog on first creation.
     *
     * An escape handler is attached ONCE on dialog creation so Escape
     * drives the explicit cancel path (onPdfModeCancel) instead of
     * orphaning the pending _processSingleSource Promise.
     *
     * @param {string} sFileName file name (for logging/future use)
     * @returns {Promise<string>} resolves with "text" or "images"
     * @private
     */
    _promptPdfMode(sFileName) {
      // If a previous PDF prompt is still pending (user dropped two PDFs
      // before answering the first dialog), resolve the first as "text"
      // so its _processSingleSource can move on — the second prompt then
      // opens below. This avoids stacking two unresolved promises.
      if (this._fnPdfResolve) {
        this._fnPdfResolve("text");
        this._fnPdfResolve = null;
        this._fnPdfReject = null;
      }

      return new Promise((resolve, reject) => {
        this._fnPdfResolve = resolve;
        this._fnPdfReject = reject;

        if (this._oPdfModeDialog) {
          this._oState.setProperty("/pdfModeIndex", 0);
          this._oPdfModeDialog.open();
          return;
        }

        Fragment.load({
          id: this.getView().getId(),
          name: "MAILING_CONSTRUCTOR.view.fragment.PdfModeDialog",
          controller: this
        }).then((oDialog) => {
          this._oPdfModeDialog = oDialog;
          this.getView().addDependent(oDialog);

          // Escape handler is set once on creation — see method JSDoc.
          oDialog.setEscapeHandler((oPromise) => {
            oPromise.reject();             // keep the dialog open
            this.onPdfModeCancel();        // drive the explicit cancel path
          });

          this._oState.setProperty("/pdfModeIndex", 0);
          oDialog.open();
        }).catch((err) => {
          this._fnPdfResolve = null;
          this._fnPdfReject = null;
          reject(err);
        });
      });
    },

    onPdfModeConfirm() {
      const bImages = (this._oState.getProperty("/pdfModeIndex") || 0) === 1;
      const sMode = bImages ? "images" : "text";
      this._oPdfModeDialog.close();
      if (this._fnPdfResolve) {
        const fnResolve = this._fnPdfResolve;
        this._fnPdfResolve = null;
        this._fnPdfReject = null;
        fnResolve(sMode);
      }
    },

    onPdfModeCancel() {
      this._oPdfModeDialog.close();
      if (this._fnPdfReject) {
        const fnReject = this._fnPdfReject;
        this._fnPdfResolve = null;
        this._fnPdfReject = null;
        fnReject(new Error("PDF import cancelled"));
      }
    },

    onPdfModeTabSelect(oEvent) {
      this._oState.setProperty("/pdfModeIndex", parseInt(oEvent.getParameter("selectedKey"), 10) || 0);
    },

    _addSourceToList(sSourceId, sType, sName) {
      const sExt = Config.getFileExt(sName);
      const aSources = (this._oState.getProperty("/sources") || []).slice();
      aSources.push({
        id: sSourceId, type: sType, name: sName, ext: sExt,
        iconSrc: SourceTypes.icon(sType, sExt),
        iconColor: SourceTypes.color(sType, sExt),
        meta: Formatter.sourceMeta(sType, new Date().toISOString()),
        addedAt: new Date().toISOString()
      });
      this._oState.setProperty("/sources", aSources);
      this._updateHeaderBadges();
    },

    onRemoveSource(oEvent) {
      const oCtx = oEvent.getSource().getBindingContext("state");
      if (!oCtx) { return; }
      const sSourceId = oCtx.getProperty("id");
      this._oEditor.removeSource(sSourceId);
      const aSources = (this._oState.getProperty("/sources") || [])
        .filter((s) => s.id !== sSourceId);
      this._oState.setProperty("/sources", aSources);
      this._updateHeaderBadges();
    },

    _reconcileSourcesWithEditor(aValidIds) {
      const mValid = {};
      (aValidIds || []).forEach((sId) => { mValid[sId] = true; });

      const aSources = this._oState.getProperty("/sources") || [];
      const aNews = this._oState.getProperty("/newsItems") || [];
      const aKeptSources = aSources.filter((s) => mValid[s.id]);
      const aKeptNews = aNews.filter((n) => mValid[n.id]);

      if (aKeptSources.length === aSources.length && aKeptNews.length === aNews.length) {
        return;
      }
      this._oState.setProperty("/sources", aKeptSources);
      this._oState.setProperty("/newsItems", aKeptNews);
      this._updateHeaderBadges();
    },

    _addNewsAsSource(oObj) {
      // CHG-flagged items (IsChange="X") get the structured announcement
      // layout (change number / initiator / area — see ZCDS_News);
      // regular news keep the plain sanitized Content as before.
      const sClean = Formatter.newsContentHtml(oObj);
      const sSourceId = Config.generateSourceId();
      this._oEditor.insert(SourceBlock.wrap(sSourceId, SourceBlock.TYPE.NEWS, sClean));

      const aNews = (this._oState.getProperty("/newsItems") || []).slice();
      aNews.push({
        id: sSourceId,
        title: oObj.Title,
        meta: Formatter.sourceMeta("news", new Date().toISOString()),
        addedAt: new Date().toISOString()
      });
      this._oState.setProperty("/newsItems", aNews);
      this._updateHeaderBadges();
    },

    onRemoveNewsItem(oEvent) {
      const oCtx = oEvent.getSource().getBindingContext("state");
      if (!oCtx) { return; }
      const sId = oCtx.getProperty("id");
      this._oEditor.removeSource(sId);
      const aNews = (this._oState.getProperty("/newsItems") || [])
        .filter((n) => n.id !== sId);
      this._oState.setProperty("/newsItems", aNews);
      this._updateHeaderBadges();
    },

    onClearAllNews() {
      const aNews = this._oState.getProperty("/newsItems") || [];
      aNews.forEach((n) => this._oEditor.removeSource(n.id));
      this._oState.setProperty("/newsItems", []);
      this._updateHeaderBadges();
      Toast.success(this._t("MSG_NEWS_CLEARED"));
    },

    onAttachmentChange(oEvent) {
      const aFiles = Array.from(oEvent.getParameter("files") || []);
      aFiles.forEach((file) => {
        if (file.size > Config.MAX_ATTACHMENT_SIZE) {
          Toast.warning(this._t("MSG_ATTACHMENT_TOO_LARGE", [file.name]));
          return;
        }
        FileProcessor.readAsDataURL(file).then((sDataUrl) => {
          const aAttachments = (this._oState.getProperty("/attachments") || []).slice();
          if (aAttachments.length >= Config.MAX_ATTACHMENTS) {
            Toast.warning(this._t("MSG_MAX_ATTACHMENTS"));
            return;
          }
          aAttachments.push({
            id: Config.generateSourceId(),
            name: file.name,
            size: file.size,
            sizeStr: Config.formatFileSize(file.size),
            base64: sDataUrl.replace(/^data:[^;]+;base64,/, ""),
            mimeType: file.type || "application/octet-stream"
          });
          this._oState.setProperty("/attachments", aAttachments);
          this._updateHeaderBadges();
        }).catch(() => {
          Toast.error(this._t("MSG_FILE_READ_ERROR") + ": " + file.name);
        });
      });
    },

    onClearAllRecipients() {
      this._oState.setProperty("/recipients", []);
      this._updateHeaderBadges();
      Toast.success(this._t("MSG_RECIPIENTS_CLEARED"));
    }
  };
});
