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

  // Centralised so the dialog table binding lookup isn't repeated.
  function applyItemsFilter(oTable, aFilters) {
    const oBinding = oTable && oTable.getBinding("items");
    if (oBinding) { oBinding.filter(aFilters); }
  }

  // Shared by the recipient/news dialogs: land on "added" when the compose
  // state already has items, otherwise default to "search".
  function setDialogDefaultTab(oDialog, aItems) {
    const oModel = oDialog && oDialog.getModel("dialog");
    if (!oModel) { return; }
    oModel.setProperty("/selectedMode", (aItems || []).length > 0 ? "added" : "search");
  }

  // Loads (once) and caches the Fragment.load PROMISE itself, not just the
  // eventual dialog, keyed by two properties on the controller instance —
  // a second opener call arriving before the first load resolves (a fast
  // double-click, or two list-press events firing in quick succession)
  // reuses this same in-flight promise instead of re-entering
  // Fragment.load with the same view-scoped id, which fails outright
  // (the fragment's declared ids are already registered from the first,
  // still-pending load). fnOnFirstLoad runs exactly once, right after the
  // dialog is created, for setup that must not repeat on later opens
  // (caching child tables, creating the dialog's own JSONModel, wiring
  // one-time event handlers).
  function loadDialogOnce(oCtrl, sDialogProp, sLoadingProp, sFragmentName, fnOnFirstLoad) {
    if (oCtrl[sDialogProp]) { return Promise.resolve(oCtrl[sDialogProp]); }
    if (!oCtrl[sLoadingProp]) {
      oCtrl[sLoadingProp] = Fragment.load({
        id: oCtrl.getView().getId(),
        name: sFragmentName,
        controller: oCtrl
      }).then((oDialog) => {
        oCtrl[sDialogProp] = oDialog;
        oCtrl.getView().addDependent(oDialog);
        if (fnOnFirstLoad) { fnOnFirstLoad(oDialog); }
        return oDialog;
      }).catch((err) => {
        oCtrl[sLoadingProp] = null;
        return Promise.reject(err);
      });
    }
    return oCtrl[sLoadingProp];
  }

  // Shared by all three dialog search handlers below (recipients/news/
  // mailings): basic-search OR group across aBasicSearchFields, plus
  // adaptSfbFiltersForMode()'s structured filters, with an optional
  // exclusion predicate (news drops the free-text Title field).
  function buildSfbFilters(oSmartFilter, aBasicSearchFields, bDetailed, fnExclude) {
    if (!oSmartFilter) { return []; }

    const sSearch = oSmartFilter.getBasicSearchValue
      ? (oSmartFilter.getBasicSearchValue() || "").trim()
      : "";
    const aFilters = (sSearch && aBasicSearchFields.length > 0)
      ? [new Filter(
          aBasicSearchFields.map((sField) => new Filter(sField, FilterOperator.Contains, sSearch)),
          false // OR
        )]
      : [];

    const aSfbFilters = oSmartFilter.getFilters ? (oSmartFilter.getFilters() || []) : [];
    let aAdapted = adaptSfbFiltersForMode(aSfbFilters, bDetailed);
    if (fnExclude) { aAdapted = aAdapted.filter((oF) => !fnExclude(oF)); }

    return aFilters.concat(aAdapted);
  }

  // Adapts SmartFilterBar#getFilters() output for the currently active table:
  // 1. EQ → Contains: SFB 1.71 defaults to EQ for text fields, but a user
  //    typing "Кузнецов" in ФИО expects a substring match, not exact.
  // 2. Grouped mode: Role → Roles rename, AuthObject/FieldName dropped.
  function adaptSfbFiltersForMode(aFilters, bDetailed) {
    if (!aFilters || aFilters.length === 0) { return []; }
    const mDrop   = { AuthObject: true, FieldName: true };
    const mRename = { Role: "Roles" };
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
      loadDialogOnce(this, "_oRecipDialog", "_pRecipDialogLoading",
        "MAILING_CONSTRUCTOR.view.fragment.RecipientSearch", (oDialog) => {
          this._oRecipTable = Fragment.byId(sViewId, "recipientTable");
          this._oRecipGroupedTable = Fragment.byId(sViewId, "recipientGroupedTable");

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

          // Cancel/Escape/a successful add all end up here — clears a CSV
          // preview the user uploaded but never added (or already added),
          // so reopening later never shows stale, already-resolved rows
          // with "Add to Recipients" still enabled.
          oDialog.attachAfterClose(() => {
            oModel.setProperty("/csvPreview", []);
            oModel.setProperty("/csvPreviewCount", 0);
          });
        }).then((oDialog) => {
          oDialog.open();
        }).catch(() => {
          Log.error("[MAILING_CONSTRUCTOR] Failed to load RecipientSearch fragment");
        });
    },

    _setRecipientDialogDefaultTab() {
      setDialogDefaultTab(this._oRecipDialog, this._oState.getProperty("/recipients"));
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

      // Detailed shows AuthObject/FieldName; grouped shows FullName/Email —
      // never both, they answer different search questions.
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
      this._removeStateItem(oEvent, "/recipients");
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
      loadDialogOnce(this, "_oNewsDialog", "_pNewsDialogLoading",
        "MAILING_CONSTRUCTOR.view.fragment.NewsSearch", (oDialog) => {
          this._oNewsTable = Fragment.byId(sViewId, "newsTable");

          const oModel = new JSONModel({ selectedMode: "search" });
          oModel.setSizeLimit(1000);
          oDialog.setModel(oModel, "dialog");

          this._setNewsDialogDefaultTab();

          oDialog.attachAfterOpen(() => {
            if (oModel.getProperty("/selectedMode") !== "added") {
              this._searchNews();
            }
          });
        }).then((oDialog) => {
          oDialog.open();
        }).catch(() => {
          Log.error("[MAILING_CONSTRUCTOR] Failed to load NewsSearch fragment");
        });
    },

    _setNewsDialogDefaultTab() {
      setDialogDefaultTab(this._oNewsDialog, this._oState.getProperty("/newsItems"));
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
      loadDialogOnce(this, "_oMailingsDialog", "_pMailingsDialogLoading",
        "MAILING_CONSTRUCTOR.view.fragment.MailingsDialog", (oDialog) => {
          this._oMailingsTable = Fragment.byId(sViewId, "mailingsTable");
          if (this._oMailingsTable) {
            this._oMailingsTable.attachItemPress((oEvent) => this.onMailingPress(oEvent));
          }
        }).then((oDialog) => {
          oDialog.open();
        }).catch((err) => {
          Log.error("[MAILING_CONSTRUCTOR] Failed to load MailingsDialog fragment: " + (err && err.message));
        });
    },

    // ----------------------------------------------------------------
    // SmartFilterBar search dispatcher
    // ----------------------------------------------------------------

    onSmartFilterSearch(oEvent) {
      const oSource = oEvent.getSource();
      if (oSource && oSource.getId().includes("recipientSFB")) {
        this._searchRecipients(oEvent);
      } else if (oSource && oSource.getId().includes("newsSFB")) {
        this._searchNews(oEvent);
      } else if (oSource && oSource.getId().includes("mailingsSFB")) {
        this.onMailingsFilterSearch();
      }
    },

    // Dispatches to grouped (RecipientUserSet) or detailed (RecipientSet)
    // table based on the current searchMode.
    _searchRecipients(oEvent) {
      if (!this._oRecipDialog) { return; }

      const oDialogModel = this._oRecipDialog.getModel("dialog");
      const bDetailed = oDialogModel.getProperty("/searchMode") === "detailed";
      const oTable = bDetailed ? this._oRecipTable : this._oRecipGroupedTable;
      if (!oTable) { return; }

      const aFilters = buildSfbFilters(this.byId("recipientSFB"), ["FullName", "Email"], bDetailed);
      applyItemsFilter(oTable, aFilters);
    },

    onAddSelectedRecipients() {
      if (!this._oRecipDialog) { return; }

      const oDialogModel = this._oRecipDialog.getModel("dialog");
      const bDetailed = oDialogModel.getProperty("/searchMode") === "detailed";
      const oTable = bDetailed ? this._oRecipTable : this._oRecipGroupedTable;
      if (!oTable) { return; }

      const aSelected = oTable.getSelectedContexts().map((oCtx) => oCtx.getObject()).filter(Boolean);
      const aNew = bDetailed
        ? aSelected.map((oObj) => ({
            id: oObj.RecipientId,
            name: oObj.FullName,
            email: oObj.Email,
            role: oObj.Role
          }))
        : aSelected.map((oObj) => ({
            id: "grp_" + (oObj.Email || "").replace(/[^a-zA-Z0-9@._-]/g, "_"),
            name: oObj.FullName,
            email: oObj.Email,
            role: oObj.Roles || ""
          }));

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

    // UI5 1.71 ODataListBinding has no changeParameters() for $search, so
    // structured $filter fields cover search here; Title is dropped
    // (free-text, $search-only on prod).
    _searchNews(oEvent) {
      if (!this._oNewsDialog || !this._oNewsTable) { return; }

      const aFilters = buildSfbFilters(this.byId("newsSFB"), [], true, (oF) => oF.sPath === "Title");
      applyItemsFilter(this._oNewsTable, aFilters);
    },

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

    onMailingsFilterSearch() {
      if (!this._oMailingsDialog || !this._oMailingsTable) { return; }

      const aFilters = buildSfbFilters(this.byId("mailingsSFB"), ["LocalID", "Subject"], true);
      applyItemsFilter(this._oMailingsTable, aFilters);
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
      this._openHistoryView(oMailing);
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
          .then((oEntry) => {
            // Discard a stale response: the user may have closed this
            // mailing and opened a different one on this same long-lived
            // "history" model before this resolved.
            if (oModel.getProperty("/mailingId") !== mailing.Key) { return; }
            oModel.setProperty("/content", oEntry.Content || "");
          })
          .catch(() => { Log.warning("[MAILING_CONSTRUCTOR] Failed to load mailing content"); });

        this._oHistoryViewDialog.open();
      };

      loadDialogOnce(this, "_oHistoryViewDialog", "_pHistoryViewDialogLoading",
        "MAILING_CONSTRUCTOR.view.fragment.HistoryView", (oDialog) => {
          oDialog.setModel(new JSONModel(oData), "history");
        }).then((oDialog) => {
          openWithModel(oDialog.getModel("history"));
        }).catch((err) => {
          Log.error("[MAILING_CONSTRUCTOR] Failed to load HistoryView fragment: " + (err && err.message));
        });
    },

    onCloseHistoryView() {
      if (this._oHistoryViewDialog) { this._oHistoryViewDialog.close(); }
    },

    // Seeds the HUD from the mailing summary's pre-aggregated counts so
    // chips render immediately, before the async per-status breakdown from
    // _loadStatusHud (MailingStatusSet) resolves. Status codes use the
    // Constants.STATUS.DISP SSOT so the HistoryView's chip formatter
    // (which keys off the same codes) lights up correctly.
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
          // Same stale-response guard as the content load in
          // _openHistoryView — this model outlives any single mailing.
          if (oModel.getProperty("/mailingId") !== sId) { return; }
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

    // sap.m.URLHelper.download is only available from UI5 1.86 — the 1.71
    // LTS baseline falls back to a manual anchor click below.
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

    // Called from App.controller#onExit.
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
      // loadDialogOnce caches these as long-lived promises — a stale
      // resolved one left behind would resolve a post-reinit opener call
      // straight to the dialog instance just destroyed above.
      this._pRecipDialogLoading = this._pNewsDialogLoading =
        this._pMailingsDialogLoading = this._pHistoryViewDialogLoading = null;
    }
  };
});
