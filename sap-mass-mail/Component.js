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

      // Service dictionary — read-only lookup tables (statuses, news types)
      // loaded once from ServiceDictSet. formatter.js reads status
      // texts/icons/states from here; SFB value-help binds to it. Allowed
      // hosts are NOT part of this: they are separately authorization-
      // checked (see _loadAllowedHosts) and must not be re-exposed here.
      this.setModel(new JSONModel({
        MAIL_STATUS: [],
        REC_STATUS:  [],
        DISP_STATUS: [],
        NEWS_TYPE:   []
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
          this._loadAllowedHosts();
        });
      }
    },

    // Groups ServiceDictSet rows by DictType into dict>/MAIL_STATUS,
    // dict>/NEWS_TYPE, etc.
    _loadServiceDict() {
      Service.getServiceDict(this).then((aAll) => {
        const oDict = this.getModel("dict");
        const mGroups = {};
        (aAll || []).forEach((oEntry) => {
          const sType = oEntry.DictType;
          if (!mGroups[sType]) { mGroups[sType] = []; }
          mGroups[sType].push(oEntry);
        });
        Object.keys(mGroups).forEach((sType) => {
          mGroups[sType].sort((a, b) => (a.SortOrder || 0) - (b.SortOrder || 0));
          oDict.setProperty("/" + sType, mGroups[sType]);
        });
        Log.info("[MAILING_CONSTRUCTOR] Service dictionary loaded: " + (aAll || []).length + " entries");
      }).catch((e) => {
        Log.warning("[MAILING_CONSTRUCTOR] Service dictionary load failed: " + (e.message || e));
      });
    },

    // Reads the sanitizer's link/image host allowlist from the properly
    // authorization-checked AllowedHostSet — kept separate from
    // _loadServiceDict so this data is never re-exposed through a view
    // that doesn't carry the same #CHECK (see ZEHS_C_Allowed_Host).
    _loadAllowedHosts() {
      Service.getAllowedHosts(this).then((aHosts) => {
        this.getModel("config").setProperty("/allowedHosts", (aHosts || []).map((h) => h.Host));
      }).catch((e) => {
        Log.warning("[MAILING_CONSTRUCTOR] Allowed hosts load failed: " + (e.message || e));
      });
    },

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

    // Shared by "after send", "clear template" and draft-reset callers.
    resetState() {
      this.getModel("state").setData(this._initialState());
    },

    destroy() {
      ["state", "config", "dict", "constants"].forEach((sModelName) => {
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

    // The "state" model carries the local recipients list (which can grow
    // past the JSONModel's default sizeLimit of 100), so this cap must
    // follow the backend's MaxRecipients once MailingConfigSet resolves
    // (see App.controller#_loadMailingConfig). Never shrinks below the
    // pre-load fallback, so a transient bad backend value can't silently
    // truncate.
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
