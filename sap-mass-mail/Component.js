sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel",
  "sap/base/Log",
  "emailbuilder/util/config",
  "emailbuilder/util/constants"
], (UIComponent, JSONModel, Log, Config, Constants) => {
  "use strict";

  return UIComponent.extend("emailbuilder.Component", {

    metadata: { manifest: "json" },

    init() {
      // Flat schema — single source of truth; every path below matches the
      // paths read by controllers, mixins and the view (no ui/data nesting).
      const oAppStateModel = new JSONModel(this._initialState());
      // Pre-load fallback (see config model comment below); raised again to
      // the backend-delivered value once MailingConfigSet resolves via
      // setStateSizeLimit(), so the JSONModel never silently truncates the
      // "Добавлено" recipients list before that cap.
      oAppStateModel.setSizeLimit(Constants.PERFORMANCE.MAX_RECIPIENTS_PER_MAILING);
      this.setModel(oAppStateModel, "state");

      // Runtime configuration delivered by the backend (AllowedHostSet,
      // MailingConfigSet). maxRecipients/subjectMaxLen start out seeded from
      // util/constants.js purely as a pre-load fallback so the UI has a sane
      // maxLength/sizeLimit before the first round-trip resolves; App
      // controller#_loadMailingConfig overwrites them from the backend
      // (the actual single source of truth — see util/service.js#getMailingConfig)
      // the moment it responds.
      this.setModel(new JSONModel({
        allowedHosts:   [],
        maxRecipients:  Constants.PERFORMANCE.MAX_RECIPIENTS_PER_MAILING,
        subjectMaxLen:  Constants.VALIDATION.SUBJECT_MAX_LEN
      }), "config");

      // Exposes util/constants.js to XML bindings (e.g. subjectInput's
      // maxLength) so a view-level literal never has to duplicate a value
      // already defined there. Read-only: no controller ever writes to it.
      this.setModel(new JSONModel(Constants), "constants");

      UIComponent.prototype.init.apply(this, arguments);

      const oODataModel = this.getModel();
      if (oODataModel) {
        oODataModel.attachMetadataFailed((oEvent) => {
          Log.warning("OData metadata failed", oEvent.getParameter("message"), "emailbuilder.Component");
        });
      }
    },

    /**
     * Initial (and reset) shape of the "state" model.
     *
     * @returns {object} fresh state payload
     * @private
     */
    _initialState() {
      return {
        localId: Config.generateLocalId(),
        viewingSubject: "",
        isSending: false,
        pdfModeIndex: 0,
        recipientCount: "",
        attachmentCount: "",
        newsCount: 0,
        sources: [],
        newsItems: [],
        attachments: [],
        recipients: []
      };
    },

    /**
     * Resets the composer state to a pristine draft with a fresh LocalId.
     * Single reset routine for "after send", "clear template" and
     * "back to current" (was duplicated across controller methods).
     */
    resetState() {
      this.getModel("state").setData(this._initialState());
    },

    destroy() {
      // FIXED: Explicit cleanup of all created models
      ["state", "config", "constants"].forEach((sModelName) => {
        const oModel = this.getModel(sModelName);
        if (oModel && !oModel.isDestroyed()) {
          oModel.destroy();
          this.setModel(null, sModelName);
        }
      });

      if (this._oMockServer) {
        this._oMockServer.destroy();
        this._oMockServer = null;
      }

      UIComponent.prototype.destroy.apply(this, arguments);
    },

    setMockServer(oMockServer) {
      this._oMockServer = oMockServer;
    },

    /**
     * Raises the "state" JSONModel's array size limit to the backend-delivered
     * MaxRecipients once MailingConfigSet resolves (see App.controller#_loadMailingConfig).
     * A no-op no-lower-than-default guard: never shrinks below the pre-load
     * fallback, so a transient bad backend value can't silently truncate.
     *
     * @param {number} iMaxRecipients backend-delivered recipient cap
     */
    setStateSizeLimit(iMaxRecipients) {
      const oStateModel = this.getModel("state");
      if (oStateModel && iMaxRecipients > Constants.PERFORMANCE.MAX_RECIPIENTS_PER_MAILING) {
        oStateModel.setSizeLimit(iMaxRecipients);
      }
    },

    getResourceBundle() {
      const oModel = this.getModel("i18n");
      return oModel ? oModel.getResourceBundle() : null;
    }
  });
});
