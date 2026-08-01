sap.ui.define([
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/library",                 // URLHelper.download for CSV template
  "MAILING_CONSTRUCTOR/util/toast",
  "sap/m/MessageBox",
  "sap/base/Log",
  "MAILING_CONSTRUCTOR/util/service",
  "MAILING_CONSTRUCTOR/util/constants",
  "MAILING_CONSTRUCTOR/util/dateUtils"
], (Fragment, JSONModel, Filter, FilterOperator, mobileLibrary, Toast, MessageBox,
    Log, Service, Constants, DateUtils) => {

  "use strict";

  const parseODataDate = DateUtils.parseODataDate;
  const URLHelper = mobileLibrary.URLHelper;

  /**
   * Applies a filter array to a table's "items" binding.
   * Centralised so the dialog table binding lookup isn't repeated.
   *
   * @param {sap.m.Table} oTable  table whose items binding should be filtered
   * @param {sap.ui.model.Filter[]} aFilters filters (empty clears)
   * @private
   */
  function applyItemsFilter(oTable, aFilters) {
    const oBinding = oTable && oTable.getBinding("items");
    if (oBinding) { oBinding.filter(aFilters); }
  }

  /**
   * Adapts SmartFilterBar#getFilters() output for the currently active table.
   *
   * 1. EQ → Contains: SFB 1.71 defaults to EQ for text fields. Business UX
   *    requires partial-match (Contains) for name/email/role — a user typing
   *    "Кузнецов" in ФИО expects all names containing that substring, not an
   *    exact match. This adapter converts EQ to Contains for known text fields.
   * 2. Grouped mode: Role → Roles rename, AuthObject/FieldName dropped.
   *
   * @param {sap.ui.model.Filter[]} aFilters from SmartFilterBar#getFilters()
   * @param {boolean} bDetailed true for detailed (RecipientSet) table
   * @returns {sap.ui.model.Filter[]} adapted filters safe for the active entity
   * @private
   */
  function adaptSfbFiltersForMode(aFilters, bDetailed) {
    if (!aFilters || aFilters.length === 0) { return []; }
    const mDrop   = { AuthObject: true, FieldName: true };
    const mRename = { Role: "Roles" };
    // Text fields where EQ should be converted to Contains (partial match UX).
    const mContainsFields = {
      FullName: true, Email: true, Role: true, Roles: true,
      LocalID: true, Subject: true, CreatedBy: true,
      Title: true, Area: true, ChangeNumber: true, InitiatorName: true
    };

    function adaptLeaf(oF) {
      // UI5 1.71 Filter exposes sPath/sOperator/oValue1 as direct properties
      // (getPath()/getOperator()/getValue1() were added in later versions).
      const sPath = oF.sPath || null;
      if (!sPath) { return oF; }
      if (!bDetailed && mDrop[sPath]) { return null; }
      const sTarget = (!bDetailed && mRename[sPath]) ? mRename[sPath] : sPath;
      const sOp = oF.sOperator || null;
      // Convert EQ → Contains for text fields (SFB 1.71 defaults to EQ).
      if (sOp === FilterOperator.EQ && mContainsFields[sPath]) {
        return new Filter(sTarget, FilterOperator.Contains, oF.oValue1, oF.oValue2);
      }
      if (sTarget !== sPath) {
        return new Filter(sTarget, sOp, oF.oValue1, oF.oValue2);
      }
      return oF;
    }
    function adapt(oF) {
      // Multi-filter: aFilters is non-empty, _bMultiFilter is true.
      const aSub = oF.aFilters;
      if (aSub && aSub.length > 0) {
        const aAdapted = aSub.map(adapt).filter(Boolean);
        if (aAdapted.length === 0) { return null; }
        // oF.bAnd (UI5 1.71 internal) — true=AND, false=OR.
        return new Filter(aAdapted, oF.bAnd !== undefined ? oF.bAnd : true);
      }
      return adaptLeaf(oF);
    }
    return aFilters.map(adapt).filter(Boolean);
  }

  return {

    // ----------------------------------------------------------------
    // Recipient dialog
    // ----------------------------------------------------------------

    onOpenRecipientDialog() {
      this._ensureDefaultModel();
      if (this._oRecipDialog) {
        this._setRecipientDialogDefaultTab();
        const oModel = this._oRecipDialog.getModel("dialog");
        if (oModel && !oModel.getProperty("/searchMode")) {
          oModel.setProperty("/searchMode", "grouped");
        }
        this._oRecipDialog.open();
        return;
      }

      const sViewId = this.getView().getId();
      Fragment.load({
        id: sViewId,
        name: "MAILING_CONSTRUCTOR.view.fragment.RecipientSearch",
        controller: this
      }).then((oDialog) => {
        this._oRecipDialog = oDialog;
        this._oRecipTable = Fragment.byId(sViewId, "recipientTable");
        this._oRecipGroupedTable = Fragment.byId(sViewId, "recipientGroupedTable");
        this.getView().addDependent(oDialog);

        // The grouped table binds to /RecipientUserSet via OData directly
        // (mirrors the detailed table on /RecipientSet); server-side
        // $filter + growing="true" handle paging.
        const oModel = new JSONModel({
          selectedMode: "search",
          searchMode: "grouped",
          csvPreview: [],
          csvPreviewCount: 0
        });
        oModel.setSizeLimit(1000);
        oDialog.setModel(oModel, "dialog");

        this._setRecipientDialogDefaultTab();

        oDialog.attachAfterOpen(() => {
          this._applyRecipientSFBVisibility();
          if (oModel.getProperty("/selectedMode") !== "added") {
            this._searchRecipients();
          }
        });

        oDialog.open();
      }).catch(() => {
        Log.error("[MAILING_CONSTRUCTOR] Failed to load RecipientSearch fragment");
      });
    },

    _setRecipientDialogDefaultTab() {
      const oModel = this._oRecipDialog && this._oRecipDialog.getModel("dialog");
      if (!oModel) { return; }
      const aRecipients = this._oState.getProperty("/recipients") || [];
      oModel.setProperty("/selectedMode", aRecipients.length > 0 ? "added" : "search");
    },

    onRecipientModeChange(oEvent) {
      const sKey = oEvent.getParameter("key") || oEvent.getParameter("selectedKey");
      const oDialogModel = this._oRecipDialog && this._oRecipDialog.getModel("dialog");
      if (!oDialogModel || !sKey) { return; }

      oDialogModel.setProperty("/searchMode", sKey);
      this._applyRecipientSFBVisibility();
      this._searchRecipients();
    },

    _applyRecipientSFBVisibility() {
      const oDialogModel = this._oRecipDialog && this._oRecipDialog.getModel("dialog");
      const bDetailed = oDialogModel && oDialogModel.getProperty("/searchMode") === "detailed";

      // Detailed (по полномочиям): show AuthObject/FieldName, hide FullName/Email.
      // Grouped (by users): show FullName/Email, hide AuthObject/FieldName.
      const oAuthCfg    = this.byId("authObjControlCfg");
      if (oAuthCfg)    { oAuthCfg.setVisibleInAdvancedArea(bDetailed); }

      const oFieldCfg   = this.byId("fieldNameControlCfg");
      if (oFieldCfg)   { oFieldCfg.setVisibleInAdvancedArea(bDetailed); }

      const oNameCfg    = this.byId("fullNameControlCfg");
      if (oNameCfg)    { oNameCfg.setVisibleInAdvancedArea(!bDetailed); }

      const oEmailCfg   = this.byId("emailControlCfg");
      if (oEmailCfg)   { oEmailCfg.setVisibleInAdvancedArea(!bDetailed); }
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

    // ----------------------------------------------------------------
    // News dialog
    // ----------------------------------------------------------------

    onOpenNewsDialog() {
      this._ensureDefaultModel();
      if (this._oNewsDialog) {
        this._setNewsDialogDefaultTab();
        this._oNewsDialog.open();
        return;
      }

      const sViewId = this.getView().getId();
      Fragment.load({
        id: sViewId,
        name: "MAILING_CONSTRUCTOR.view.fragment.NewsSearch",
        controller: this
      }).then((oDialog) => {
        this._oNewsDialog = oDialog;
        this._oNewsTable = Fragment.byId(sViewId, "newsTable");
        this.getView().addDependent(oDialog);

        const oModel = new JSONModel({ selectedMode: "search" });
        oModel.setSizeLimit(1000);
        oDialog.setModel(oModel, "dialog");

        this._setNewsDialogDefaultTab();

        oDialog.attachAfterOpen(() => {
          if (oModel.getProperty("/selectedMode") !== "added") {
            this._searchNews();
          }
        });

        oDialog.open();
      }).catch(() => {
        Log.error("[MAILING_CONSTRUCTOR] Failed to load NewsSearch fragment");
      });
    },

    _setNewsDialogDefaultTab() {
      const oModel = this._oNewsDialog && this._oNewsDialog.getModel("dialog");
      if (!oModel) { return; }
      const aNews = this._oState.getProperty("/newsItems") || [];
      oModel.setProperty("/selectedMode", aNews.length > 0 ? "added" : "search");
    },

    onNewsTabSelect(oEvent) {
      if (oEvent.getParameter("selectedKey") !== "added") { this._searchNews(); }
    },

    // ----------------------------------------------------------------
    // Mailings dialog
    // ----------------------------------------------------------------

    onOpenMailingsDialog() {
      this._ensureDefaultModel();
      if (this._oMailingsDialog) {
        this._oMailingsDialog.open();
        return;
      }
      const sViewId = this.getView().getId();
      Fragment.load({
        id: sViewId,
        name: "MAILING_CONSTRUCTOR.view.fragment.MailingsDialog",
        controller: this
      }).then((oDialog) => {
        this._oMailingsDialog = oDialog;
        this._oMailingsTable = Fragment.byId(sViewId, "mailingsTable");
        this.getView().addDependent(oDialog);
        if (this._oMailingsTable) {
          this._oMailingsTable.attachItemPress((oEvent) => this.onMailingPress(oEvent));
        }

        // The mailings table binds to /MailHistorySet via OData directly,
        // paging itself via growing="true"; onFilterMailings pushes
        // server-side Filter objects to the items binding.
        oDialog.open();
      }).catch((err) => {
        Log.error("[MAILING_CONSTRUCTOR] Failed to load MailingsDialog fragment: " + err.message);
      });
    },

    // ----------------------------------------------------------------
    // SmartFilterBar search dispatcher
    // ----------------------------------------------------------------

    onSmartFilterSearch(oEvent) {
      const oSource = oEvent.getSource();
      if (oSource && oSource.getId().indexOf("recipientSFB") !== -1) {
        this._searchRecipients(oEvent);
      } else if (oSource && oSource.getId().indexOf("newsSFB") !== -1) {
        this._searchNews(oEvent);
      } else if (oSource && oSource.getId().indexOf("mailingsSFB") !== -1) {
        this.onMailingsFilterSearch();
      }
    },

    /**
     * Recipient search — dispatches to grouped (RecipientUserSet) or
     * detailed (RecipientSet) table based on the current searchMode.
     *
     * Filters come from SmartFilterBar#getFilters() (already-built Filter
     * objects); adaptSfbFiltersForMode() translates Role -> Roles and drops
     * AuthObject/FieldName in grouped mode. The basic search value is
     * folded in as an OR group on FullName/Email.
     *
     * @param {sap.ui.base.Event} [oEvent] optional SmartFilterBar search event
     * @private
     */
    _searchRecipients(oEvent) {
      if (!this._oRecipDialog) { return; }

      const oDialogModel = this._oRecipDialog.getModel("dialog");
      const bDetailed = oDialogModel.getProperty("/searchMode") === "detailed";
      const oTable = bDetailed ? this._oRecipTable : this._oRecipGroupedTable;
      if (!oTable) { return; }

      let aFilters = [];
      const oSmartFilter = this.byId("recipientSFB");
      if (oSmartFilter) {
        // Basic search: OR across FullName and Email (both entities have these)
        const sSearch = oSmartFilter.getBasicSearchValue
          ? oSmartFilter.getBasicSearchValue()
          : "";
        if (sSearch) {
          aFilters.push(new Filter([
            new Filter("FullName", FilterOperator.Contains, sSearch),
            new Filter("Email", FilterOperator.Contains, sSearch)
          ], false)); // false = OR
        }

        // Structured filters from the SFB (Role/AuthObject/FieldName/Email/FullName)
        const aSfbFilters = oSmartFilter.getFilters
          ? (oSmartFilter.getFilters() || [])
          : [];
        aFilters = aFilters.concat(adaptSfbFiltersForMode(aSfbFilters, bDetailed));
      }

      applyItemsFilter(oTable, aFilters);
    },

    onSearchRecipients() { this._searchRecipients(); },

    /**
     * Adds selected recipients to the compose state.
     * Handles both detailed (RecipientSet) and grouped (RecipientUserSet) tables.
     */
    onAddSelectedRecipients() {
      if (!this._oRecipDialog) { return; }

      const oDialogModel = this._oRecipDialog.getModel("dialog");
      const bDetailed = oDialogModel.getProperty("/searchMode") === "detailed";
      const oTable = bDetailed ? this._oRecipTable : this._oRecipGroupedTable;
      if (!oTable) { return; }

      let aNew;
      if (bDetailed) {
        aNew = oTable.getSelectedContexts()
          .map((oCtx) => oCtx.getObject())
          .filter(Boolean)
          .map((oObj) => ({
            id: oObj.RecipientId,
            name: oObj.FullName,
            email: oObj.Email,
            role: oObj.Role
          }));
      } else {
        aNew = oTable.getSelectedContexts()
          .map((oCtx) => oCtx.getObject())
          .filter(Boolean)
          .map((oObj) => ({
            id: "grp_" + (oObj.Email || "").replace(/[^a-zA-Z0-9@._-]/g, "_"),
            name: oObj.FullName,
            email: oObj.Email,
            role: oObj.Roles || ""
          }));
      }

      if (aNew.length === 0) {
        Toast.warning(this._t("WARN_NO_RECIPIENTS"));
        return;
      }

      const aMerged = (this._oState.getProperty("/recipients") || []).slice();
      const mExisting = {};
      aMerged.forEach((r) => { mExisting[(r.email || "").toLowerCase()] = true; });

      let iAdded = 0;
      aNew.forEach((r) => {
        const sKey = (r.email || "").toLowerCase();
        if (!mExisting[sKey]) { aMerged.push(r); mExisting[sKey] = true; iAdded++; }
      });

      this._oState.setProperty("/recipients", aMerged);
      this._updateHeaderBadges();
      Toast.success(this._t("MSG_RECIPIENTS_ADDED", [iAdded]));
      this._closeDialog(this._oRecipDialog);
    },

    onRecipTabSelect(oEvent) {
      const sKey = oEvent.getParameter("selectedKey");
      if (sKey !== "added" && sKey !== "csv") { this._searchRecipients(); }
    },

    // ----------------------------------------------------------------
    // News search
    // ----------------------------------------------------------------

    /**
     * News search — structured $filter via SmartFilterBar.getFilters().
     *
     * UI5 1.71 ODataListBinding has no changeParameters() for $search, so
     * the SFB's structured $filter fields (NewsType/Year/Quarter/Area/
     * ChangeNumber/InitiatorName) cover the practical search UX in the
     * 1.71 binding path. Title is dropped (free-text, $search-only on prod).
     *
     * @param {sap.ui.base.Event} [oEvent] optional SmartFilterBar search event
     * @private
     */
    _searchNews(oEvent) {
      if (!this._oNewsDialog || !this._oNewsTable) { return; }

      const oSmartFilter = this.byId("newsSFB");
      const aFilters = [];

      if (oSmartFilter) {
        const aSfbFilters = oSmartFilter.getFilters
          ? (oSmartFilter.getFilters() || [])
          : [];
        // Adapt EQ → Contains for text fields; drop Title (free-text, $search-only on prod).
        const aAdapted = adaptSfbFiltersForMode(aSfbFilters, true);
        aAdapted.forEach((oF) => {
          const sPath = oF.sPath || null;
          if (sPath === "Title") { return; }
          aFilters.push(oF);
        });
      }

      const oBinding = this._oNewsTable.getBinding("items");
      if (oBinding) {
        oBinding.filter(aFilters);
      }
    },

    onSearchNews() { this._searchNews(); },

    onAddSelectedNews() {
      if (!this._oNewsDialog || !this._oNewsTable) { return; }
      const aSelected = this._oNewsTable.getSelectedContexts()
        .map((oCtx) => oCtx.getObject())
        .filter(Boolean);
      aSelected.forEach((oObj) => this._addNewsAsSource(oObj));
      if (aSelected.length > 0) {
        Toast.success(this._t("MSG_NEWS_ADDED", [aSelected.length]));
      }
      this._closeDialog(this._oNewsDialog);
    },

    // ----------------------------------------------------------------
    // Mailings filter — SmartFilterBar-driven server-side $filter
    // ----------------------------------------------------------------

    /**
     * SmartFilterBar search handler for MailHistorySet.
     *
     * The SmartFilterBar (mailingsSFB) is the SSOT for its own filter state;
     * the search event calls getFilters() and applies the resulting
     * server-side Filter objects to the table's items binding. Basic search
     * (the SFB's searchField) is folded into an OR on LocalID/Subject.
     */
    onMailingsFilterSearch() {
      if (!this._oMailingsDialog || !this._oMailingsTable) { return; }

      const oSmartFilter = this.byId("mailingsSFB");
      const aFilters = [];

      if (oSmartFilter) {
        // Basic search: OR across LocalID and Subject (both text fields).
        const sSearch = oSmartFilter.getBasicSearchValue
          ? (oSmartFilter.getBasicSearchValue() || "").trim()
          : "";
        if (sSearch) {
          aFilters.push(new Filter([
            new Filter("LocalID", FilterOperator.Contains, sSearch),
            new Filter("Subject", FilterOperator.Contains, sSearch)
          ], false)); // false = OR
        }

        // Structured filters from the SFB — adapt EQ → Contains for text fields.
        const aSfbFilters = oSmartFilter.getFilters
          ? (oSmartFilter.getFilters() || [])
          : [];
        aFilters.push(...adaptSfbFiltersForMode(aSfbFilters, true));
      }

      applyItemsFilter(this._oMailingsTable, aFilters);
    },

    /**
     * Clears the SmartFilterBar and re-applies an empty filter to the table.
     */
    onResetMailingsFilter() {
      const oSmartFilter = this.byId("mailingsSFB");
      if (oSmartFilter && typeof oSmartFilter.clear === "function") {
        oSmartFilter.clear();
      }
      if (this._oMailingsTable) {
        applyItemsFilter(this._oMailingsTable, []);
      }
    },

    // ----------------------------------------------------------------
    // History view
    // ----------------------------------------------------------------

    onMailingPress(oEvent) {
      const oItem = oEvent.getParameter("listItem") || oEvent.getSource();
      if (!oItem || !oItem.getBindingContext) { return; }
      const oCtx = oItem.getBindingContext();
      if (!oCtx) { return; }
      const oMailing = oCtx.getObject();
      if (!oMailing) { return; }
      this._closeDialog(this._oMailingsDialog);

      const oRaw = Object.assign({}, oMailing);
      if (oRaw.CreatedAt instanceof Date) {
        oRaw.CreatedAt = "/Date(" + oRaw.CreatedAt.getTime() + ")/";
      }
      this._openHistoryView(oRaw);
    },

    _openHistoryView(mailing) {
      const oData = {
        mailingId: mailing.Key,
        subject: mailing.Subject,
        localId: mailing.LocalID || mailing.LocalId || "",
        createdAt: this.formatter.dateTime(mailing.CreatedAt),
        content: "",
        hud: { statuses: [], total: 0 }
      };

      const openWithModel = (oModel) => {
        oModel.setData(oData);
        this._applyMailingStatusToHud(oModel, mailing);
        this._loadStatusHud(oModel, mailing.Key);

        Service.getMailingContent(this.getOwnerComponent(), mailing.Key)
          .then((oEntry) => oModel.setProperty("/content", oEntry.Content || ""))
          .catch(() => { Log.warning("[MAILING_CONSTRUCTOR] Failed to load mailing content"); });

        this._oHistoryViewDialog.open();
      };

      if (this._oHistoryViewDialog) {
        openWithModel(this._oHistoryViewDialog.getModel("history"));
        return;
      }

      Fragment.load({
        id: this.getView().getId(),
        name: "MAILING_CONSTRUCTOR.view.fragment.HistoryView",
        controller: this
      }).then((oDialog) => {
        this._oHistoryViewDialog = oDialog;
        oDialog.setModel(new JSONModel(oData), "history");
        this.getView().addDependent(oDialog);
        openWithModel(oDialog.getModel("history"));
      }).catch((err) => {
        Log.error("[MAILING_CONSTRUCTOR] Failed to load HistoryView fragment: " + err.message);
      });
    },

    onCloseHistoryView() {
      if (this._oHistoryViewDialog) { this._oHistoryViewDialog.close(); }
    },

    /**
     * Seeds the HistoryView HUD from the mailing summary's pre-aggregated
     * SentCount/ErrorCount/TotalCount. The detailed per-status breakdown
     * arrives asynchronously via _loadStatusHud (MailingStatusSet read);
     * this method gives the HUD an immediate non-empty state so the
     * chips render before the network round-trip resolves.
     *
     * Status codes use the Constants.STATUS.DISP SSOT (display domain,
     * 020=pending / 040=sent / 050=failed) so the HistoryView's chip
     * formatter (which keys off these same display codes) lights up.
     */
    _applyMailingStatusToHud(oModel, mailing) {
      const iTotal   = mailing.TotalCount || 0;
      const iSent    = mailing.SentCount  || 0;
      const iError   = mailing.ErrorCount || 0;
      const iPending = Math.max(0, iTotal - iSent - iError);
      const aStatuses = [];
      if (iSent > 0)    { aStatuses.push({ Status: Constants.STATUS.DISP.SENT,    Count: iSent }); }
      if (iError > 0)   { aStatuses.push({ Status: Constants.STATUS.DISP.FAILED,  Count: iError }); }
      if (iPending > 0) { aStatuses.push({ Status: Constants.STATUS.DISP.PENDING, Count: iPending }); }
      oModel.setProperty("/hud", { statuses: aStatuses, total: iTotal });
    },

    _loadStatusHud(oModel, sId) {
      Service.getMailingStatus(this.getOwnerComponent(), sId)
        .then((aStatuses) => {
          if (aStatuses && aStatuses.length > 0) {
            const iTotal = aStatuses.reduce((acc, s) => acc + (s.Count || s.Cnt || 0), 0);
            oModel.setProperty("/hud", {
              statuses: aStatuses.map((s) => ({ Status: s.Status, Count: s.Count || s.Cnt || 0 })),
              total: iTotal
            });
          }
        })
        .catch(() => { Log.warning("[MAILING_CONSTRUCTOR] Failed to load status HUD"); });
    },

    onCopyViewingMailing() {
      const oModel = this._oHistoryViewDialog && this._oHistoryViewDialog.getModel("history");
      const sId = oModel && oModel.getProperty("/mailingId");
      if (!sId) { return; }
      MessageBox.confirm(this._t("CONFIRM_COPY"), {
        title: this._t("CONFIRM_COPY_TITLE"),
        onClose: (action) => {
          if (action !== MessageBox.Action.OK) { return; }
          Service.copyMailing(this.getOwnerComponent(), sId)
            .then((data) => {
              this._closeDialog(this._oHistoryViewDialog);
              this._resetComposer();
              this._oState.setProperty("/viewingSubject", data.Subject || "");
              this._oState.setProperty("/localId", data.LocalId);
              if (data.Content) { this._oEditor.setValue(data.Content); }
              Toast.success(this._t("MSG_MAILING_COPIED", [data.LocalId]));
            })
            .catch(() => { Toast.error(this._t("MSG_SEND_ERROR")); });
        }
      });
    },

    // ----------------------------------------------------------------
    // CSV upload
    // ----------------------------------------------------------------

    /**
     * Generates and downloads a CSV template file.
     *
     * Uses sap.m.URLHelper.download (available from UI5 1.86); on the 1.71
     * LTS baseline it falls back to a manual anchor click.
     */
    onDownloadCsvTemplate() {
      const sContent = "example@noreply.com\n";
      const oBlob = new Blob(["\uFEFF" + sContent], { type: "text/csv;charset=utf-8" });
      const sUrl = URL.createObjectURL(oBlob);
      const sFilename = "recipients_template.csv";

      if (URLHelper && typeof URLHelper.download === "function") {
        URLHelper.download(sUrl, sFilename, "text/csv");
        // URLHelper.download manages its own anchor; revoke after a tick
        // to give the browser time to start the download.
        setTimeout(() => URL.revokeObjectURL(sUrl), 1000);
      } else {
        // 1.71 LTS fallback (URLHelper.download not yet available).
        const oLink = document.createElement("a");
        oLink.href = sUrl;
        oLink.download = sFilename;
        document.body.appendChild(oLink);
        oLink.click();
        document.body.removeChild(oLink);
        URL.revokeObjectURL(sUrl);
      }
      Toast.success(this._t("CSV_TEMPLATE_DOWNLOADED"));
    },

    /**
     * Handles CSV file selection from the FileUploader.
     * Reads, sanitizes (DOMPurify), extracts valid emails, deduplicates.
     */
    onCsvFileChange(oEvent) {
      const oFile = oEvent.getParameter("files") && oEvent.getParameter("files")[0];
      if (!oFile) { return; }

      const oDialogModel = this._oRecipDialog && this._oRecipDialog.getModel("dialog");
      if (!oDialogModel) { return; }

      oDialogModel.setProperty("/csvPreview", []);
      oDialogModel.setProperty("/csvPreviewCount", 0);

      const oReader = new FileReader();
      oReader.onload = (oReadEvent) => {
        try {
          let sRaw = oReadEvent.target.result || "";
          if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
            sRaw = window.DOMPurify.sanitize(sRaw, {
              ALLOWED_TAGS: [],
              ALLOWED_ATTR: []
            });
          }

          const aLines = sRaw.split(/\r?\n/);
          const aEmails = [];
          const mSeen = {};
          const aExisting = this._oState.getProperty("/recipients") || [];
          aExisting.forEach((r) => {
            const sEmail = (r.email || "").toLowerCase().trim();
            if (sEmail) { mSeen[sEmail] = true; }
          });

          for (let i = 0; i < aLines.length; i++) {
            const sLine = aLines[i].trim();
            if (!sLine) { continue; }

            const aParts = sLine.split(/[,;\t]/);
            const sCell = (aParts[0] || "").trim().replace(/^["']|["']$/g, "");
            if (!sCell) { continue; }

            const sLower = sCell.toLowerCase();
            if (mSeen[sLower]) { continue; }
            if (!Constants.VALIDATION.EMAIL_PATTERN.test(sCell)) { continue; }

            mSeen[sLower] = true;
            aEmails.push({
              id: "csv_" + i + "_" + Date.now(),
              name: sCell,
              email: sCell,
              role: ""
            });
          }

          if (aEmails.length === 0) {
            Toast.warning(this._t("CSV_NO_VALID_EMAILS"));
            return;
          }

          oDialogModel.setProperty("/csvPreview", aEmails);
          oDialogModel.setProperty("/csvPreviewCount", aEmails.length);
          Toast.success(this._t("CSV_PARSED_SUCCESS", [aEmails.length]));
        } catch (e) {
          Log.error("[MAILING_CONSTRUCTOR] CSV parse error: " + e.message);
          Toast.error(this._t("CSV_PARSE_ERROR"));
        }
      };

      oReader.onerror = () => {
        Toast.error(this._t("MSG_FILE_READ_ERROR"));
      };

      oReader.readAsText(oFile, "utf-8");
    },

    /**
     * Adds all emails from the CSV preview into the recipients list.
     */
    onAddCsvRecipients() {
      if (!this._oRecipDialog) { return; }
      const oDialogModel = this._oRecipDialog.getModel("dialog");
      if (!oDialogModel) { return; }

      const aCsvEmails = oDialogModel.getProperty("/csvPreview") || [];
      if (aCsvEmails.length === 0) {
        Toast.warning(this._t("CSV_NO_VALID_EMAILS"));
        return;
      }

      const aMerged = (this._oState.getProperty("/recipients") || []).slice();
      const mExisting = {};
      aMerged.forEach((r) => {
        const sKey = (r.email || "").toLowerCase().trim();
        if (sKey) { mExisting[sKey] = true; }
      });

      let iAdded = 0;
      aCsvEmails.forEach((r) => {
        const sKey = (r.email || "").toLowerCase().trim();
        if (!mExisting[sKey]) {
          aMerged.push({ id: r.id, name: r.email, email: r.email, role: "" });
          mExisting[sKey] = true;
          iAdded++;
        }
      });

      this._oState.setProperty("/recipients", aMerged);
      this._updateHeaderBadges();

      oDialogModel.setProperty("/csvPreview", []);
      oDialogModel.setProperty("/csvPreviewCount", 0);

      // Reset the CSV uploader using Fragment.byId for view-scoped lookup.
      const sViewId = this.getView().getId();
      const oUploader = Fragment.byId(sViewId, "csvFileUploader");
      if (oUploader && typeof oUploader.clear === "function") {
        try { oUploader.clear(); } catch (e) { /* FileUploader.clear may not exist in 1.71 */ }
      }

      oDialogModel.setProperty("/selectedMode", "added");

      if (iAdded > 0) {
        Toast.success(this._t("MSG_RECIPIENTS_ADDED", [iAdded]));
      } else {
        Toast.warning(this._t("CSV_ALL_DUPLICATES"));
      }
    },

    // ----------------------------------------------------------------
    // Lifecycle
    // ----------------------------------------------------------------

    /**
     * Cleanup hook — destroys all dialogs managed by this mixin.
     * Called from App.controller#onExit.
     */
    onExitCleanup() {
      // Destroy dialog models before dialogs — setModel() doesn't auto-destroy
      // the previous model, so the "dialog"/"history" named models leak if
      // not explicitly destroyed (one model per dialog × N opens = N leaks).
      const aDialogs = [this._oRecipDialog, this._oNewsDialog, this._oMailingsDialog,
        this._oPdfModeDialog, this._oHistoryViewDialog];
      aDialogs.forEach((oDialog) => {
        if (!oDialog || oDialog.isDestroyed()) { return; }
        ["dialog", "history", "mailings"].forEach((sName) => {
          const oM = oDialog.getModel(sName);
          if (oM && oM.destroy && !oM.isDestroyed()) {
            oM.destroy();
          }
        });
        oDialog.destroyContent();
        oDialog.destroy();
      });
      this._oRecipDialog = this._oNewsDialog = this._oMailingsDialog =
        this._oPdfModeDialog = this._oHistoryViewDialog = null;
      this._oRecipTable = this._oRecipGroupedTable = this._oNewsTable =
        this._oMailingsTable = null;
    }
  };
});
