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

  // Enforced at the mixin-instance level so multiple drop events share one
  // worker budget (each source may spawn a pdfjs/docx worker).
  const MAX_CONCURRENT_FILES = 2;

  return {

    onSourceChange(oEvent) {
      this._handleSourceDrop(oEvent.getParameter("files") || []);
    },

    onAttachmentDeleted(oEvent) {
      this._removeStateItem(oEvent, "/attachments");
    },

    // Called explicitly from App.controller#onExit (NOT named
    // onExitCleanup: that name is already owned by DialogMixin in the
    // Object.assign merge order — BaseController.extend(name,
    // Object.assign({}, DialogMixin, SourcesMixin, {...})) — "last wins"
    // would silently drop DialogMixin's dialog cleanup if this collided
    // with it). Flips a flag _finalizeSource checks before touching
    // _oEditor/_oState, and settles any PDF-mode prompt still waiting on
    // an answer instead of leaving it — and the file promise chain closed
    // over it — hanging forever.
    _destroySourcesQueue() {
      this._bSourcesDestroyed = true;
      this._aSourceQueue = [];
      if (this._aPdfPromptQueue && this._aPdfPromptQueue.length) {
        this._aPdfPromptQueue.forEach((oEntry) => oEntry.reject(new Error("View destroyed")));
        this._aPdfPromptQueue = [];
      }
    },

    // Queue + active counter are created lazily so the mixin stays a plain object.
    _handleSourceDrop(fileList) {
      const aFiles = Array.from(fileList || []);
      if (!aFiles.length) { return; }

      if (!Array.isArray(this._aSourceQueue))        { this._aSourceQueue = []; }
      if (typeof this._iActiveSources !== "number")  { this._iActiveSources = 0; }

      this._aSourceQueue = this._aSourceQueue.concat(aFiles);
      this._drainSourceQueue();
    },

    // Idempotent — a no-op when the queue is empty or the active cap is reached.
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
      // A source still processing (e.g. a large .docx/.pdf awaiting a
      // worker) can resolve after the controller is torn down (component
      // re-init, route change) — _destroySourcesQueue below sets this
      // flag before App.controller#onExit nulls _oEditor/_oState, so this
      // becomes a clean no-op instead of a TypeError on a null editor.
      if (this._bSourcesDestroyed) { return; }
      this._oEditor.insert(sHtml);
      this._addSourceToList(sSourceId, SourceBlock.TYPE.FILE, sName);
    },

    // Queues pending {fileName, resolve, reject} prompts and shows the
    // dialog for one at a time. A single shared resolve/reject pair used
    // to stand in for "the current prompt" — safe only if at most one
    // _promptPdfMode call was ever in flight, which MAX_CONCURRENT_FILES=2
    // (two files draining together) violates: dropping 2+ PDFs at once
    // would force-resolve an earlier file's mode to "text" without ever
    // showing it a dialog, and could clobber a later file's still-pending
    // resolver. Each call now gets its own entry, so no caller can be
    // silently skipped or resolved with someone else's answer.
    _promptPdfMode(sFileName) {
      return new Promise((resolve, reject) => {
        if (!Array.isArray(this._aPdfPromptQueue)) { this._aPdfPromptQueue = []; }
        this._aPdfPromptQueue.push({ fileName: sFileName, resolve: resolve, reject: reject });
        if (this._aPdfPromptQueue.length === 1) {
          this._showNextPdfPrompt();
        }
      });
    },

    // Opens the dialog for the queue's head entry. onPdfModeConfirm/Cancel
    // settle that same entry and call this again for whatever is next.
    _showNextPdfPrompt() {
      if (!this._aPdfPromptQueue || !this._aPdfPromptQueue.length) { return; }

      this._getPdfModeDialog().then((oDialog) => {
        this._oState.setProperty("/pdfModeIndex", 0);
        oDialog.open();
      }).catch((err) => {
        const oEntry = this._aPdfPromptQueue.shift();
        if (oEntry) { oEntry.reject(err); }
        this._showNextPdfPrompt();
      });
    },

    // Loads and caches the Fragment.load PROMISE itself (not just the
    // eventual dialog) — a second caller arriving before the first load
    // resolves reuses this same in-flight promise instead of re-entering
    // Fragment.load with the same view-scoped id, which fails because the
    // fragment's declared ids are already registered from the first load.
    _getPdfModeDialog() {
      if (this._oPdfModeDialog) { return Promise.resolve(this._oPdfModeDialog); }
      if (!this._pPdfModeDialogLoading) {
        this._pPdfModeDialogLoading = Fragment.load({
          id: this.getView().getId(),
          name: "MAILING_CONSTRUCTOR.view.fragment.PdfModeDialog",
          controller: this
        }).then((oDialog) => {
          this._oPdfModeDialog = oDialog;
          this.getView().addDependent(oDialog);

          // Attached ONCE (this whole branch only runs on the first,
          // cached load) so Escape always drives the explicit cancel
          // path instead of orphaning whatever prompt is showing.
          oDialog.setEscapeHandler((oPromise) => {
            oPromise.reject();             // keep the dialog open
            this.onPdfModeCancel();        // drive the explicit cancel path
          });

          return oDialog;
        }).catch((err) => {
          this._pPdfModeDialogLoading = null;
          return Promise.reject(err);
        });
      }
      return this._pPdfModeDialogLoading;
    },

    onPdfModeConfirm() {
      const bImages = (this._oState.getProperty("/pdfModeIndex") || 0) === 1;
      const sMode = bImages ? "images" : "text";
      this._oPdfModeDialog.close();
      this._settleCurrentPdfPrompt((oEntry) => oEntry.resolve(sMode));
    },

    onPdfModeCancel() {
      this._oPdfModeDialog.close();
      this._settleCurrentPdfPrompt((oEntry) => oEntry.reject(new Error("PDF import cancelled")));
    },

    _settleCurrentPdfPrompt(fnSettle) {
      if (!this._aPdfPromptQueue || !this._aPdfPromptQueue.length) { return; }
      const oEntry = this._aPdfPromptQueue.shift();
      fnSettle(oEntry);
      this._showNextPdfPrompt();
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
      const sSourceId = this._removeStateItem(oEvent, "/sources");
      if (sSourceId) { this._oEditor.removeSource(sSourceId); }
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
      // layout (change number / initiator / area — see ZEHS_C_News);
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
      const sId = this._removeStateItem(oEvent, "/newsItems");
      if (sId) { this._oEditor.removeSource(sId); }
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
      const aExisting = this._oState.getProperty("/attachments") || [];
      // Running total checked synchronously (before the async file read)
      // so files rejected for size never pay for a FileReader pass, and so
      // several files dropped in the same batch are weighed against each
      // other. This is only a fast-path pre-check, though: two batches
      // dropped in quick succession would otherwise both read this same
      // stale aExisting snapshot and could each pass here, only to
      // together exceed the aggregate cap once both FileReaders resolve —
      // the write below re-derives the total from fresh state (the same
      // place MAX_ATTACHMENTS' count is already re-checked) as the
      // authoritative check.
      let iRunningTotal = aExisting.reduce((iSum, a) => iSum + (a.size || 0), 0);

      aFiles.forEach((file) => {
        if (file.size > Config.MAX_ATTACHMENT_SIZE) {
          Toast.warning(this._t("MSG_ATTACHMENT_TOO_LARGE", [file.name]));
          return;
        }
        if (iRunningTotal + file.size > Config.MAX_TOTAL_ATTACHMENTS_SIZE) {
          Toast.warning(this._t("MSG_ATTACHMENTS_TOTAL_TOO_LARGE", [file.name]));
          return;
        }
        iRunningTotal += file.size;

        FileProcessor.readAsDataURL(file).then((sDataUrl) => {
          const aAttachments = (this._oState.getProperty("/attachments") || []).slice();
          if (aAttachments.length >= Config.MAX_ATTACHMENTS) {
            Toast.warning(this._t("MSG_MAX_ATTACHMENTS"));
            return;
          }
          const iFreshTotal = aAttachments.reduce((iSum, a) => iSum + (a.size || 0), 0);
          if (iFreshTotal + file.size > Config.MAX_TOTAL_ATTACHMENTS_SIZE) {
            Toast.warning(this._t("MSG_ATTACHMENTS_TOTAL_TOO_LARGE", [file.name]));
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
