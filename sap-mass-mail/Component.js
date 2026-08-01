sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel",
  "sap/base/Log",
  "MAILING_CONSTRUCTOR/util/config",
  "MAILING_CONSTRUCTOR/util/constants",
  "MAILING_CONSTRUCTOR/util/sanitize",
  "MAILING_CONSTRUCTOR/util/service",
  "MAILING_CONSTRUCTOR/model/formatter"
], (UIComponent, JSONModel, Log, Config, Constants, Sanitize, Service, Formatter) => {
  "use strict";

  return UIComponent.extend("MAILING_CONSTRUCTOR.Component", {

    metadata: { manifest: "json" },

    init() {
      const oAppStateModel = new JSONModel(this._initialState());
      oAppStateModel.setSizeLimit(Constants.PERFORMANCE.MAX_RECIPIENTS_PER_MAILING);
      this.setModel(oAppStateModel, "state");

      this.setModel(new JSONModel({
        allowedHosts:   [],
        maxRecipients:  Constants.PERFORMANCE.MAX_RECIPIENTS_PER_MAILING,
        subjectMaxLen:  Constants.VALIDATION.SUBJECT_MAX_LEN
      }), "config");

      // Service dictionary — all lookup tables (statuses, news types,
      // allowed hosts) loaded once from ServiceDictSet. formatter.js reads
      // status texts/icons/states from here; SFB value-help binds to it.
      this.setModel(new JSONModel({
        MAIL_STATUS:  [],
        REC_STATUS:   [],
        DISP_STATUS:  [],
        NEWS_TYPE:    [],
        ALLOWED_HOST: []
      }), "dict");

      this.setModel(new JSONModel(Constants), "constants");

      UIComponent.prototype.init.apply(this, arguments);

      const oODataModel = this.getModel();
      if (oODataModel) {
        oODataModel.attachMetadataFailed((oEvent) => {
          Log.warning("OData metadata failed", oEvent.getParameter("message"), "MAILING_CONSTRUCTOR.Component");
        });
        // Load the service dictionary as soon as metadata is available —
        // formatter.js and SFB value-help depend on it being populated.
        oODataModel.metadataLoaded().then(() => {
          this._loadServiceDict();
        });
      }
    },

    /**
     * Loads ServiceDictSet and populates the "dict" JSONModel by DictType.
     * Each DictType becomes a property path: dict>/MAIL_STATUS, dict>/NEWS_TYPE, etc.
     * @private
     */
    _loadServiceDict() {
      Service.getServiceDict(this).then((aAll) => {
        const oDict = this.getModel("dict");
        const mGroups = {};
        (aAll || []).forEach((oEntry) => {
          const sType = oEntry.DictType;
          if (!mGroups[sType]) { mGroups[sType] = []; }
          mGroups[sType].push(oEntry);
        });
        // Sort each group by SortOrder
        Object.keys(mGroups).forEach((sType) => {
          mGroups[sType].sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
          oDict.setProperty("/" + sType, mGroups[sType]);
        });
        // Also populate config>/allowedHosts from ALLOWED_HOST entries
        const aHosts = (mGroups["ALLOWED_HOST"] || []).map((h) => h.DictKey);
        this.getModel("config").setProperty("/allowedHosts", aHosts);
        Log.info("[MAILING_CONSTRUCTOR] Service dictionary loaded: " + (aAll || []).length + " entries");
      }).catch((e) => {
        Log.warning("[MAILING_CONSTRUCTOR] Service dictionary load failed: " + (e.message || e));
      });
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
     * Shared reset routine for "after send", "clear template" and
     * "back to current".
     */
    resetState() {
      this.getModel("state").setData(this._initialState());
    },

    destroy() {
      // Explicit cleanup of all created models
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

      // Clear module-level singletons to prevent stale state across
      // component lifecycles (module is a singleton, not instance-scoped).
      Sanitize.removeHooks();
      Formatter.reset();

      UIComponent.prototype.destroy.apply(this, arguments);
    },

    setMockServer(oMockServer) {
      this._oMockServer = oMockServer;
    },

    /**
     * Raises the "state" JSONModel's array size limit to the backend-delivered
     * MaxRecipients once MailingConfigSet resolves (see App.controller#_loadMailingConfig).
     *
     * The "state" model carries the local recipients list (which can grow past
     * the JSONModel's default sizeLimit of 100), so this cap must follow the
     * backend's MaxRecipients. A no-op no-lower-than-default guard: never
     * shrinks below the pre-load fallback, so a transient bad backend value
     * can't silently truncate.
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
