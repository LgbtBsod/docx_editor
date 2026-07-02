sap.ui.define([
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/base/Log",
  "emailbuilder/util/service"
], (Fragment, JSONModel, Filter, FilterOperator, MessageToast, MessageBox,
    Log, Service) => {
  "use strict";

  /**
   * Applies a filter array to a table's "items" ODataListBinding. Server-side
   * paging is handled by the binding — no result set is materialised here.
   *
   * @param {sap.m.Table} oTable table whose items binding to filter
   * @param {sap.ui.model.Filter[]} aFilters filters to apply
   * @private
   */
  function applyItemsFilter(oTable, aFilters) {
    const oBinding = oTable && oTable.getBinding("items");
    if (oBinding) { oBinding.filter(aFilters); }
  }

  return {

    onOpenRecipientDialog() {
      this._ensureDefaultModel();
      if (this._oRecipDialog) {
        this._setRecipientDialogDefaultTab();
        this._oRecipDialog.open();
        return;
      }

      const sViewId = this.getView().getId();
      Fragment.load({
        id: sViewId,
        name: "emailbuilder.view.fragment.RecipientSearch",
        controller: this
      }).then((oDialog) => {
        this._oRecipDialog = oDialog;
        this._oRecipTable = Fragment.byId(sViewId, "recipientTable");
        this.getView().addDependent(oDialog);

        const oModel = new JSONModel({
          selectedMode: "name",
          nameSearchValue: "",
          roleSearchValue: "",
          authObject: "",
          authField: "",
          authValue: ""
        });
        oModel.setSizeLimit(1000);
        oDialog.setModel(oModel, "dialog");

        this._setRecipientDialogDefaultTab();

        // FIXED: Store handler reference for cleanup
        this._oRecipDialogOpenHandler = () => {
          if (oModel.getProperty("/selectedMode") !== "added") {
            this._searchRecipients();
          }
        };
        oDialog.attachAfterOpen(this._oRecipDialogOpenHandler);

        oDialog.open();
      }).catch((err) => {
        Log.error("[emailbuilder] Failed to load RecipientSearch fragment");
      });
    },

    _setRecipientDialogDefaultTab() {
      const oModel = this._oRecipDialog && this._oRecipDialog.getModel("dialog");
      if (!oModel) { return; }
      const aRecipients = this._oState.getProperty("/recipients") || [];
      oModel.setProperty("/selectedMode", aRecipients.length > 0 ? "added" : "name");
    },

    onRemoveAddedRecipient(oEvent) {
      const oCtx = oEvent.getSource().getBindingContext("state");
      if (!oCtx) { return; }
      const sId = oCtx.getProperty("id");
      const aRecipients = (this._oState.getProperty("/recipients") || [])
        .filter((r) => r.id !== sId);
      this._oState.setProperty("/recipients", aRecipients);
      this._updateHeaderBadges();
    },

    onOpenNewsDialog() {
      this._ensureDefaultModel();
      if (this._oNewsDialog) {
        this._oNewsDialog.open();
        return;
      }

      const sViewId = this.getView().getId();
      Fragment.load({
        id: sViewId,
        name: "emailbuilder.view.fragment.NewsSearch",
        controller: this
      }).then((oDialog) => {
        this._oNewsDialog = oDialog;
        this._oNewsTable = Fragment.byId(sViewId, "newsTable");
        this.getView().addDependent(oDialog);

        const oModel = new JSONModel({ year: "", quarter: "all", area: "" });
        oModel.setSizeLimit(1000);
        oDialog.setModel(oModel, "dialog");

        this._oNewsDialogOpenHandler = () => this._searchNews();
        oDialog.attachAfterOpen(this._oNewsDialogOpenHandler);

        oDialog.open();
      }).catch((err) => {
        Log.error("[emailbuilder] Failed to load NewsSearch fragment");
      });
    },

    onOpenMailingsDialog() {
      this._ensureDefaultModel();
      if (this._oMailingsDialog) {
        this._oMailingsDialog.open();
        return;
      }
      const sViewId = this.getView().getId();
      Fragment.load({
        id: sViewId,
        name: "emailbuilder.view.fragment.MailingsDialog",
        controller: this
      }).then((oDialog) => {
        this._oMailingsDialog = oDialog;
        this._oMailingsTable = Fragment.byId(sViewId, "mailingsTable");
        this.getView().addDependent(oDialog);
        if (this._oMailingsTable) {
          this._oMailingsTable.attachItemPress((oEvent) => this.onMailingPress(oEvent));
        }
        oDialog.open();
      }).catch((err) => {
        Log.error("[emailbuilder] Failed to load MailingsDialog fragment: " + err.message);
      });
    },

    onSearchRecipients() { this._searchRecipients(); },

    _searchRecipients() {
      if (!this._oRecipDialog || !this._oRecipTable) { return; }
      const oDialogModel = this._oRecipDialog.getModel("dialog");
      if (!oDialogModel) { return; }
      const sMode = oDialogModel.getProperty("/selectedMode") || "name";
      const aFilters = [];
      if (sMode === "name") {
        const sValue = oDialogModel.getProperty("/nameSearchValue");
        if (sValue) { aFilters.push(new Filter("FullName", FilterOperator.Contains, sValue)); }
      } else if (sMode === "role") {
        const sValue = oDialogModel.getProperty("/roleSearchValue");
        if (sValue) { aFilters.push(new Filter("Role", FilterOperator.Contains, sValue)); }
      } else if (sMode === "authField") {
        const sObj = oDialogModel.getProperty("/authObject");
        const sField = oDialogModel.getProperty("/authField");
        if (sObj)   { aFilters.push(new Filter("AuthObject", FilterOperator.Contains, sObj)); }
        if (sField) { aFilters.push(new Filter("FieldName", FilterOperator.Contains, sField)); }
      }
      applyItemsFilter(this._oRecipTable, aFilters);
    },

    onAddSelectedRecipients() {
      if (!this._oRecipDialog || !this._oRecipTable) { return; }
      const aNew = this._oRecipTable.getSelectedContexts()
        .map((oCtx) => oCtx.getObject())
        .filter(Boolean)
        .map((oObj) => ({ id: oObj.RecipientId, name: oObj.FullName, email: oObj.Email, role: oObj.Role }));

      if (aNew.length === 0) {
        MessageToast.show(this._t("WARN_NO_RECIPIENTS"));
        return;
      }

      const aMerged = (this._oState.getProperty("/recipients") || []).slice();
      const mExisting = {};
      aMerged.forEach((r) => { mExisting[r.id] = true; });
      aNew.forEach((r) => {
        if (!mExisting[r.id]) { aMerged.push(r); mExisting[r.id] = true; }
      });

      this._oState.setProperty("/recipients", aMerged);
      this._updateHeaderBadges();
      MessageToast.show(this._t("MSG_RECIPIENTS_ADDED", [aNew.length]));
      this._closeDialog(this._oRecipDialog);
    },

    onRecipTabSelect(oEvent) {
      if (oEvent.getParameter("selectedKey") !== "added") { this._searchRecipients(); }
    },

    onSearchNews() { this._searchNews(); },

    _searchNews() {
      if (!this._oNewsDialog || !this._oNewsTable) { return; }
      const oDialogModel = this._oNewsDialog.getModel("dialog");
      if (!oDialogModel) { return; }
      const aFilters = [];
      const sYear = oDialogModel.getProperty("/year");
      if (sYear && sYear !== "all") {
        aFilters.push(new Filter("Year", FilterOperator.EQ, parseInt(sYear, 10)));
      }
      const sQuarter = oDialogModel.getProperty("/quarter");
      if (sQuarter && sQuarter !== "all") {
        aFilters.push(new Filter("Quarter", FilterOperator.EQ, parseInt(sQuarter, 10)));
      }
      const sArea = oDialogModel.getProperty("/area");
      if (sArea) {
        aFilters.push(new Filter("Area", FilterOperator.Contains, sArea));
      }
      applyItemsFilter(this._oNewsTable, aFilters);
    },

    onAddSelectedNews() {
      if (!this._oNewsDialog || !this._oNewsTable) { return; }
      const aSelected = this._oNewsTable.getSelectedContexts()
        .map((oCtx) => oCtx.getObject())
        .filter(Boolean);
      aSelected.forEach((oObj) => this._addNewsAsSource(oObj));
      if (aSelected.length > 0) {
        MessageToast.show(this._t("MSG_NEWS_ADDED", [aSelected.length]));
      }
      this._closeDialog(this._oNewsDialog);
    },

    onMailingPress(oEvent) {
      const oItem = oEvent.getParameter("listItem") || oEvent.getSource();
      if (!oItem || !oItem.getBindingContext) { return; }
      const oCtx = oItem.getBindingContext();
      if (!oCtx) { return; }
      const oMailing = oCtx.getObject();
      if (!oMailing) { return; }
      this._closeDialog(this._oMailingsDialog);
      this._openHistoryView(oMailing);
    },

    _openHistoryView(mailing) {
      this._oState.setProperty("/viewingMailingId", mailing.Key);
      this._oState.setProperty("/viewingSubject", mailing.Subject);
      this._oState.setProperty("/viewingLocalId", mailing.LocalID || mailing.LocalId || "");
      this._oState.setProperty("/viewingCreatedAt", this.formatter.dateTime(mailing.CreatedAt));

      // LOB travels only on demand: MailHistorySet no longer carries Content.
      this._oState.setProperty("/historyContent", "");
      Service.getMailingContent(this.getOwnerComponent(), mailing.Key)
        .then((oEntry) => this._oState.setProperty("/historyContent", oEntry.Content || ""))
        .catch(() => { /* preview stays empty; counts remain available */ });

      this._applyMailingStatusToHud(mailing);
      this._loadStatusHud(mailing.Key);

      if (this._oHistoryViewDialog) { this._oHistoryViewDialog.open(); return; }

      Fragment.load({
        id: this.getView().getId(),
        name: "emailbuilder.view.fragment.HistoryView",
        controller: this
      }).then((oDialog) => {
        this._oHistoryViewDialog = oDialog;
        this.getView().addDependent(oDialog);
        oDialog.open();
      }).catch((err) => {
        Log.error("[emailbuilder] Failed to load HistoryView fragment: " + err.message);
      });
    },

    onCloseHistoryView() {
      if (this._oHistoryViewDialog) { this._oHistoryViewDialog.close(); }
    },

    /**
     * Pushes the status breakdown from the history row counts to the HUD.
     *
     * @param {object} mailing mailing entity
     * @private
     */
    _applyMailingStatusToHud(mailing) {
      const iTotal   = mailing.TotalCount || 0;
      const iSent    = mailing.SentCount  || 0;
      const iError   = mailing.ErrorCount || 0;
      const iPending = Math.max(0, iTotal - iSent - iError);
      const aStatuses = [];
      if (iSent > 0)    { aStatuses.push({ Status: "040", Count: iSent }); }
      if (iError > 0)   { aStatuses.push({ Status: "050", Count: iError }); }
      if (iPending > 0) { aStatuses.push({ Status: "020", Count: iPending }); }
      this._oHud.setData({ statuses: aStatuses, total: iTotal });
    },

    /**
     * Refreshes the HUD with live aggregated statuses. ZI_Mailing_Status maps
     * receiver codes to the unified display domain in CDS, so the payload
     * uses the same dictionary as _applyMailingStatusToHud.
     *
     * @param {string} sId mailing key
     * @private
     */
    _loadStatusHud(sId) {
      Service.getMailingStatus(this.getOwnerComponent(), sId)
        .then((aStatuses) => {
          if (aStatuses && aStatuses.length > 0) {
            const iTotal = aStatuses.reduce((acc, s) => acc + (s.Count || s.Cnt || 0), 0);
            this._oHud.setData({
              statuses: aStatuses.map((s) => ({ Status: s.Status, Count: s.Count || s.Cnt || 0 })),
              total: iTotal
            });
          }
        })
        .catch(() => { /* keep counts-based HUD data */ });
    },

    onCopyViewingMailing() {
      const sId = this._oState.getProperty("/viewingMailingId");
      if (!sId) { return; }
      MessageBox.confirm(this._t("CONFIRM_COPY"), {
        title: this._t("CONFIRM_COPY_TITLE"),
        onClose: (action) => {
          if (action !== MessageBox.Action.OK) { return; }
          Service.copyMailing(this.getOwnerComponent(), sId)
            .then((data) => {
              this._resetComposer();
              this._oState.setProperty("/viewingSubject", data.Subject || "");
              this._oState.setProperty("/localId", data.LocalId);
              if (data.Content) { this._oEditor.setValue(data.Content); }
              MessageToast.show(this._t("MSG_MAILING_COPIED", [data.LocalId]));
            })
            .catch(() => { MessageToast.show(this._t("MSG_SEND_ERROR")); });
        }
      });
    },

    onNavigateToCurrent() {
      this._resetComposer();
    }
  };
});
