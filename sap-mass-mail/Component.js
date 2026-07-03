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
      // Must cover the backend's max recipients per mailing (see the
      // constant's own comment) — a lower limit here would silently
      // truncate the "Добавлено" recipients list well before that cap.
      oAppStateModel.setSizeLimit(Constants.PERFORMANCE.MAX_RECIPIENTS_PER_MAILING);
      this.setModel(oAppStateModel, "state");

      // Runtime configuration delivered by the backend (AllowedHostSet).
      // Client-side limits live in util/config.js only (single source).
      this.setModel(new JSONModel({ allowedHosts: [] }), "config");

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

    getResourceBundle() {
      const oModel = this.getModel("i18n");
      return oModel ? oModel.getResourceBundle() : null;
    }
  });
});
