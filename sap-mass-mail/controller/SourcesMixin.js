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

      const sMode = sExt === ".pdf" ? "text" : null;
      return FileProcessor.process(file, sSourceId, sMode, oBundle)
        .then((sHtml) => this._finalizeSource(sHtml, sSourceId, sExt, file.name));
    },

    _finalizeSource(sHtml, sSourceId, sExt, sName) {
      this._oEditor.insert(sHtml);
      this._addSourceToList(sSourceId, "file", sName);
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
