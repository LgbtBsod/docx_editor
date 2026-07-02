sap.ui.define([
  "sap/ui/core/Fragment",
  "sap/m/MessageToast",
  "emailbuilder/util/config",
  "emailbuilder/util/sanitize",
  "emailbuilder/util/sourceBlock",
  "emailbuilder/util/fileProcessor",
  "emailbuilder/util/sourceTypes",
  "emailbuilder/model/formatter"
], (Fragment, MessageToast, Config, Sanitize, SourceBlock, FileProcessor,
    SourceTypes, Formatter) => {
  "use strict";

  const MAX_CONCURRENT_FILES = 2;

  return {

    onSourceChange(oEvent) {
      this._handleSourceDrop(oEvent.getParameter("files") || []);
    },

    onAttachmentDeleted(oEvent) {
      const oCtx = oEvent.getSource().getBindingContext("state");
      if (!oCtx) { return; }
      // Attachments are identified by generated id, not by (non-unique) name.
      const sId = oCtx.getProperty("id");
      const aAttachments = (this._oState.getProperty("/attachments") || [])
        .filter((a) => a.id !== sId);
      this._oState.setProperty("/attachments", aAttachments);
      this._updateHeaderBadges();
    },

    /**
     * Handles dropped/picked source files with a small concurrency window.
     *
     * @param {FileList|File[]} fileList files to process
     */
    _handleSourceDrop(fileList) {
      const aFiles = Array.from(fileList || []);
      if (!aFiles.length) { return; }
      let iActive = 0, iIndex = 0;
      const processNext = () => {
        while (iIndex < aFiles.length && iActive < MAX_CONCURRENT_FILES) {
          iActive++;
          const file = aFiles[iIndex++];
          this._processSingleSource(file)
            .then(() => { iActive--; processNext(); })
            .catch((err) => {
              if (err && err.message && err.message !== "PDF import cancelled") {
                MessageToast.show(err.message);
              }
              iActive--; processNext();
            });
        }
      };
      processNext();
    },

    _processSingleSource(file) {
      const sExt = Config.getFileExt(file.name);
      const sSourceId = Config.generateSourceId();
      const oBundle = this._getBundle();

      if (file.size > Config.MAX_SOURCE_SIZE) {
        return Promise.reject(new Error(this._t("MSG_FILE_TOO_LARGE", [file.name])));
      }
      if (!Config.mimeMatchesExt(sExt, file.type)) {
        MessageToast.show(this._t("MSG_MIME_MISMATCH", [file.name, file.type]));
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
      this._addSourceToList(sSourceId, "file", sName);
      if (sExt === ".pdf") {
        // pdfModeRow visibility is bound to {state>/showPdfMode} in the view.
        this._oState.setProperty("/showPdfMode", true);
      }
    },

    /**
     * Prompts the user for a PDF import mode via the PdfModeDialog fragment.
     * Resolves with the selected mode ("text" | "images"), rejects on cancel.
     *
     * @param {string} sFileName file name (informational)
     * @returns {Promise<string>} chosen mode
     * @private
     */
    _promptPdfMode(sFileName) {
      if (this._fnPdfResolve) {
        this._fnPdfResolve(this._oState.getProperty("/pdfMode") || "text");
        this._fnPdfResolve = null;
        this._fnPdfReject = null;
      }

      return new Promise((resolve, reject) => {
        this._fnPdfResolve = resolve;
        this._fnPdfReject = reject;

        if (this._oPdfModeDialog) {
          this._oPdfModeDialog.open();
          return;
        }

        Fragment.load({
          id: this.getView().getId(),
          name: "emailbuilder.view.fragment.PdfModeDialog",
          controller: this
        }).then((oDialog) => {
          this._oPdfModeDialog = oDialog;
          this.getView().addDependent(oDialog);
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
      this._oState.setProperty("/pdfMode", sMode);
      this._oState.setProperty("/showPdfMode", true);
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

    onPdfModeChange(oEvent) {
      this._oState.setProperty("/pdfMode", oEvent.getParameter("selectedKey") || "text");
    },

    onPdfModeTabSelect(oEvent) {
      this._oState.setProperty("/pdfModeIndex", parseInt(oEvent.getParameter("selectedKey"), 10) || 0);
    },

    _addSourceToList(sSourceId, sType, sName) {
      const sExt = Config.getFileExt(sName);
      // Copy-on-write: bindings always receive a new array reference.
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

    /**
     * Hides the PDF mode row when no PDF source remains.
     *
     * @param {Array} aSources current sources list
     * @private
     */
    _refreshPdfModeVisibility(aSources) {
      if (!(aSources || []).some((s) => s.ext === ".pdf")) {
        this._oState.setProperty("/showPdfMode", false);
      }
    },

    onRemoveSource(oEvent) {
      const oCtx = oEvent.getSource().getBindingContext("state");
      if (!oCtx) { return; }
      const sSourceId = oCtx.getProperty("id");
      this._oEditor.removeSource(sSourceId);
      const aSources = (this._oState.getProperty("/sources") || [])
        .filter((s) => s.id !== sSourceId);
      this._oState.setProperty("/sources", aSources);
      this._refreshPdfModeVisibility(aSources);
      this._updateHeaderBadges();
    },

    _addNewsAsSource(oObj) {
      const sClean = Sanitize.forImport(oObj.Content || "");
      const sSourceId = Config.generateSourceId();
      this._oEditor.insert(SourceBlock.wrap(sSourceId, "news", oObj.Title, sClean));
      this._addSourceToList(sSourceId, "news", oObj.Title);
    },

    onClearAllNews() {
      const aAll = this._oState.getProperty("/sources") || [];
      // Keep editor content and source list in sync: remove the inserted
      // blocks from the editor as well (was: list cleared, HTML left behind).
      aAll.filter((s) => s.type === "news")
          .forEach((s) => this._oEditor.removeSource(s.id));
      this._oState.setProperty("/sources", aAll.filter((s) => s.type !== "news"));
      this._updateHeaderBadges();
      MessageToast.show(this._t("MSG_NEWS_CLEARED"));
    },

    onAttachmentChange(oEvent) {
      const aFiles = Array.from(oEvent.getParameter("files") || []);
      aFiles.forEach((file) => {
        if (file.size > Config.MAX_ATTACHMENT_SIZE) {
          MessageToast.show(this._t("MSG_ATTACHMENT_TOO_LARGE", [file.name]));
          return;
        }
        FileProcessor.readAsDataURL(file).then((sDataUrl) => {
          const aAttachments = (this._oState.getProperty("/attachments") || []).slice();
          if (aAttachments.length >= Config.MAX_ATTACHMENTS) {
            MessageToast.show(this._t("MSG_MAX_ATTACHMENTS"));
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
          MessageToast.show(this._t("MSG_FILE_READ_ERROR") + ": " + file.name);
        });
      });
    },

    onClearAllRecipients() {
      this._oState.setProperty("/recipients", []);
      this._updateHeaderBadges();
      MessageToast.show(this._t("MSG_RECIPIENTS_CLEARED"));
    },

    onCopyLocalId() {
      const sText = this._oState.getProperty("/localId") || "";
      if (sText && navigator && navigator.clipboard
          && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(sText)
          .then(() => MessageToast.show(this._t("MSG_LOCALID_COPIED")))
          .catch(() => { /* clipboard blocked; ignore silently */ });
      }
    }
  };
});
