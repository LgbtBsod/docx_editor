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

    // Shared by every "remove this chip" handler (attachments/sources/
    // news/recipients): pulls the id off the pressed row's "state" binding
    // context, filters it out of the named state array, and refreshes the
    // header badges. Returns the removed id (or null) so callers that also
    // need to detach an editor block (removeSource) can do so afterward.
    _removeStateItem(oEvent, sStateProperty) {
      const oCtx = oEvent.getSource().getBindingContext("state");
      if (!oCtx) { return null; }
      const sId = oCtx.getProperty("id");
      const aItems = (this._oState.getProperty(sStateProperty) || [])
        .filter((oItem) => oItem.id !== sId);
      this._oState.setProperty(sStateProperty, aItems);
      this._updateHeaderBadges();
      return sId;
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
