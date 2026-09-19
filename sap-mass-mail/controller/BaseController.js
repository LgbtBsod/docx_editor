sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/base/Log",
  "sap/m/Dialog"
], (Controller, Log, Dialog) => {
  "use strict";

  return Controller.extend("MAILING_CONSTRUCTOR.controller.BaseController", {

    _getBundle() {
      if (!this._oCachedBundle) {
        const oComp = this.getOwnerComponent();
        const oModel = oComp ? oComp.getModel("i18n") : null;
        this._oCachedBundle = oModel ? oModel.getResourceBundle() : null;
      }
      return this._oCachedBundle;
    },

    _t(sKey, aArgs) {
      const oBundle = this._getBundle();
      if (!oBundle) { return sKey; }
      try {
        return oBundle.getText(sKey, aArgs);
      } catch (e) {
        Log.warning("[MAILING_CONSTRUCTOR] i18n lookup failed for key: " + sKey);
        return sKey;
      }
    },

    // `_oState` is set by App.controller#onInit before any mixin handler fires.
    _updateHeaderBadges() {
      const oState = this._oState;
      if (!oState) { return; }
      const aRecipients  = oState.getProperty("/recipients")  || [];
      const aAttachments = oState.getProperty("/attachments") || [];
      const aNewsItems   = oState.getProperty("/newsItems")   || [];
      oState.setProperty("/recipientCount",
        aRecipients.length ? this._t("RECIPIENT_COUNT", [aRecipients.length]) : "");
      oState.setProperty("/attachmentCount",
        aAttachments.length ? this._t("ATTACHMENT_COUNT", [aAttachments.length]) : "");
      oState.setProperty("/newsCount", aNewsItems.length);
    },

    // The OData model is created asynchronously and isn't available at
    // onInit — this runs from the dialog openers instead, by which point
    // it's guaranteed ready, so dependents added via addDependent inherit it.
    _ensureDefaultModel() {
      const oView = this.getView();
      if (oView && !oView.getModel()) {
        const oData = this.getOwnerComponent().getModel();
        if (oData) { oView.setModel(oData); }
      }
    },

    _closeDialog(oControl) {
      if (!oControl) { return; }
      if (oControl instanceof Dialog) {
        oControl.close();
        return;
      }
      let oDialog = oControl.getParent();
      while (oDialog && !(oDialog instanceof Dialog)) {
        oDialog = oDialog.getParent();
      }
      if (oDialog) { oDialog.close(); }
    },

    _destroyDialog(oDialog) {
      if (!oDialog) { return; }
      if (oDialog instanceof Dialog && !oDialog.isDestroyed()) {
        oDialog.destroyContent();
        oDialog.destroy();
      }
    },

    // Override point for derived controllers — runs before onExit() below.
    onExitCleanup() {
      this._oCachedBundle = null;
    },

    onExit() {
      this.onExitCleanup();
    }
  });
});
