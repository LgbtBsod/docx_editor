sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/base/Log",
  "sap/m/Dialog"
], (Controller, Log, Dialog) => {
  "use strict";

  return Controller.extend("emailbuilder.controller.BaseController", {

    /**
     * Lazy-cached i18n resource bundle.
     *
     * @returns {sap.base.i18n.ResourceBundle|null} cached bundle or null
     * @private
     */
    _getBundle() {
      if (!this._oCachedBundle) {
        const oComp = this.getOwnerComponent();
        const oModel = oComp ? oComp.getModel("i18n") : null;
        this._oCachedBundle = oModel ? oModel.getResourceBundle() : null;
      }
      return this._oCachedBundle;
    },

    /**
     * Looks up a translated text from the i18n resource bundle.
     *
     * @param {string} sKey i18n key
     * @param {Array} [aArgs] format arguments
     * @returns {string} translated text (or the key when missing)
     */
    _t(sKey, aArgs) {
      const oBundle = this._getBundle();
      if (!oBundle) { return sKey; }
      try {
        return oBundle.getText(sKey, aArgs);
      } catch (e) {
        Log.warning("[emailbuilder] i18n lookup failed for key: " + sKey);
        return sKey;
      }
    },

    /**
     * Recomputes the header badge texts and the news counter from the state
     * model. Single implementation shared by the controller and all mixins.
     */
    _updateHeaderBadges() {
      const oState = this._oState;
      if (!oState) { return; }
      const aRecipients  = oState.getProperty("/recipients")  || [];
      const aAttachments = oState.getProperty("/attachments") || [];
      const aSources     = oState.getProperty("/sources")     || [];
      oState.setProperty("/recipientCount",
        aRecipients.length ? this._t("RECIPIENT_COUNT", [aRecipients.length]) : "");
      oState.setProperty("/attachmentCount",
        aAttachments.length ? this._t("ATTACHMENT_COUNT", [aAttachments.length]) : "");
      oState.setProperty("/newsCount", aSources.filter((s) => s.type === "news").length);
    },

    /**
     * Ensures the default (unnamed) OData model is present on the view so that
     * dialogs added via addDependent inherit it. The model is created
     * asynchronously and is not available at onInit; this is called from the
     * dialog openers, by which point it is guaranteed ready. Idempotent.
     *
     * @returns {void}
     */
    _ensureDefaultModel() {
      const oView = this.getView();
      if (oView && !oView.getModel()) {
        const oData = this.getOwnerComponent().getModel();
        if (oData) { oView.setModel(oData); }
      }
    },

    /**
     * Closes the sap.m.Dialog that owns the given control (or the dialog
     * itself when passed directly).
     *
     * @param {sap.ui.core.Control|sap.m.Dialog} oControl control inside a dialog, or the dialog
     */
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

    onExit() {
      this._oCachedBundle = null;
    }
  });
});
