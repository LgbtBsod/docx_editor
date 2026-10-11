sap.ui.define([
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/model/Sorter",
  "sap/m/library",
  "MAILING_CONSTRUCTOR/util/toast",
  "sap/m/MessageBox",
  "sap/base/Log",
  "MAILING_CONSTRUCTOR/util/service",
  "MAILING_CONSTRUCTOR/util/constants",
  "MAILING_CONSTRUCTOR/util/dateUtils"
], (Fragment, JSONModel, Filter, FilterOperator, Sorter, mobileLibrary, Toast, MessageBox,
    Log, Service, Constants, DateUtils) => {
  "use strict";

  const { parseODataDate } = DateUtils;
  const { URLHelper } = mobileLibrary;

  const applyItemsFilter = (oTable, aFilters) => {
    const oBinding = oTable?.getBinding("items");
    if (oBinding) {
      oBinding.filter(aFilters);
    }
  };

  const loadDialogOnce = (oTarget, sDialogProp, sLoadingProp, sFragmentName, fnOnFirstLoad) => {
    if (oTarget[sDialogProp]) {
      return Promise.resolve(oTarget[sDialogProp]);
    }
    if (oTarget[sLoadingProp]) {
      return oTarget[sLoadingProp];
    }

    oTarget[sLoadingProp] = Fragment.load({
      id: oTarget.getView().getId(),
      name: sFragmentName,
      controller: oTarget
    }).then((oDialog) => {
      oTarget[sDialogProp] = oDialog;
      oTarget[sLoadingProp] = null;
      oTarget.getView().addDependent(oDialog);
      if (typeof fnOnFirstLoad === "function") {
        fnOnFirstLoad(oDialog);
      }
      return oDialog;
    }).catch((err) => {
      oTarget[sLoadingProp] = null;
      throw err;
    });

    return oTarget[sLoadingProp];
  };

  const buildSfbFilters = (oSFB, aStringFieldNames = [], bIncludeSelectVariants = false, fnExclude = null) => {
    if (!oSFB) { return []; }
    const aFilters = [];

    (aStringFieldNames || []).forEach((sField) => {
      const oCtrl = oSFB.getControlByKey(sField);
      const sVal = oCtrl?.getValue ? oCtrl.getValue().trim() : "";
      if (sVal) {
        aFilters.push(new Filter(sField, FilterOperator.Contains, sVal));
      }
    });

    if (bIncludeSelectVariants) {
      const aFilterData = oSFB.getFilters() || [];
      const flattenFilters = (aList) => {
        (aList || []).forEach((oF) => {
          if (oF.aFilters) {
            flattenFilters(oF.aFilters);
          } else if (oF.sPath) {
            if (typeof fnExclude === "function" && fnExclude(oF)) {
              return;
            }
            aFilters.push(oF);
          }
        });
      };
      flattenFilters(aFilterData);
    }

    return aFilters;
  };

  const adaptSfbFiltersForMode = (aFilters = [], bDetailed = false) => {
    const aDisallowed = bDetailed ? ["Roles", "AuthCount"] : ["AuthObject", "FieldName", "Low"];
    const aResult = [];

    const walk = (aList) => {
      (aList || []).forEach((oFilter) => {
        if (oFilter.aFilters) {
          const aChild = adaptSfbFiltersForMode(oFilter.aFilters, bDetailed);
          if (aChild.length > 0) {
            aResult.push(new Filter({ filters: aChild, and: oFilter.bAnd }));
          }
        } else if (oFilter.sPath && !aDisallowed.includes(oFilter.sPath)) {
          aResult.push(oFilter);
        }
      });
    };

    walk(aFilters);
    return aResult;
  };

  return {
    _clearTableSelections(oTable) {
      if (oTable && typeof oTable.removeSelections === "function") {
        oTable.removeSelections(true);
      }
    },

    _ensureDefaultModel() {
      const oView = this.getView();
      if (oView && !oView.getModel()) {
        const oComponent = this.getOwnerComponent();
        const oComponentModel = oComponent?.getModel();
        if (oComponentModel) {
          oView.setModel(oComponentModel);
        }
      }
    },

    // ----------------------------------------------------------------
    // Диалог получателей
    // ----------------------------------------------------------------

    onOpenRecipientDialog() {
      this._ensureDefaultModel();

      const prepareDialogState = (oDialog) => {
        const oModel = oDialog.getModel("dialog");
        if (oModel) {
          oModel.setProperty("/selectedMode", "search");
          if (!oModel.getProperty("/searchMode")) {
            oModel.setProperty("/searchMode", "grouped");
          }
        }

        const oTabs = Fragment.byId(this.getView().getId(), "recipientTabs");
        if (oTabs) {
          oTabs.setSelectedKey("search");
        }

        this._clearTableSelections(this._oRecipTable);
        this._clearTableSelections(this._oRecipGroupedTable);
        this._applyRecipientSFBVisibility();
        oDialog.open();
      };

      if (this._oRecipDialog) {
        prepareDialogState(this._oRecipDialog);
        return;
      }

      const sViewId = this.getView().getId();
      loadDialogOnce(this, "_oRecipDialog", "_pRecipDialogLoading",
        "MAILING_CONSTRUCTOR.view.fragment.RecipientSearch", (oDialog) => {
          this._oRecipSmartTable = Fragment.byId(sViewId, "recipientSmartTable");
          this._oRecipGroupedSmartTable = Fragment.byId(sViewId, "recipientGroupedSmartTable");
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

          oDialog.attachAfterClose(() => {
            oModel.setProperty("/csvPreview", []);
            oModel.setProperty("/csvPreviewCount", 0);
            this._clearTableSelections(this._oRecipTable);
            this._clearTableSelections(this._oRecipGroupedTable);
          });
        }).then((oDialog) => {
          prepareDialogState(oDialog);
        }).catch((err) => {
          Log.error("[MAILING_CONSTRUCTOR] Failed to load RecipientSearch fragment: " + (err?.message || err));
        });
    },

    onRecipTabSelect(oEvent) {
      const sKey = oEvent.getParameter("key") || oEvent.getParameter("selectedKey");
      const oModel = this._oRecipDialog?.getModel("dialog");
      if (oModel && sKey) {
        oModel.setProperty("/selectedMode", sKey);
      }
    },

    onRecipientModeChange(oEvent) {
      const sKey = oEvent.getParameter("key") || oEvent.getParameter("selectedKey");
      const oDialogModel = this._oRecipDialog?.getModel("dialog");
      if (!oDialogModel || !sKey) { return; }

      oDialogModel.setProperty("/searchMode", sKey);
      this._clearTableSelections(this._oRecipTable);
      this._clearTableSelections(this._oRecipGroupedTable);
      this._applyRecipientSFBVisibility();
    },

    _applyRecipientSFBVisibility() {
      const oDialogModel = this._oRecipDialog?.getModel("dialog");
      const bDetailed = oDialogModel?.getProperty("/searchMode") === "detailed";

      const mControls = {
        authObjControlCfg: bDetailed,
        fieldNameControlCfg: bDetailed,
        lowControlCfg: bDetailed,
        fullNameControlCfg: !bDetailed,
        emailControlCfg: !bDetailed
      };

      Object.entries(mControls).forEach(([sId, bVisible]) => {
        const oCfg = Fragment.byId(this.getView().getId(), sId) || this.byId(sId);
        if (oCfg?.setVisibleInAdvancedArea) {
          oCfg.setVisibleInAdvancedArea(bVisible);
        }
      });
    },

    onAddSelectedRecipients() {
      if (!this._oRecipDialog) { return; }

      const oDialogModel = this._oRecipDialog.getModel("dialog");
      const bDetailed = oDialogModel.getProperty("/searchMode") === "detailed";
      const oTable = bDetailed
        ? (this._oRecipSmartTable ? this._oRecipSmartTable.getTable() : this._oRecipTable)
        : (this._oRecipGroupedSmartTable ? this._oRecipGroupedSmartTable.getTable() : this._oRecipGroupedTable);

      if (!oTable) { return; }

      const aSelected = oTable.getSelectedContexts().map((ctx) => ctx.getObject()).filter(Boolean);
      const aNew = bDetailed
        ? aSelected.map((obj) => ({
            id: obj.RecipientId,
            name: obj.FullName,
            email: obj.Email,
            role: obj.Role
          }))
        : aSelected.map((obj) => ({
            id: `grp_${(obj.Email || "").replace(/[^a-zA-Z0-9@._-]/g, "_")}`,
            name: obj.FullName,
            email: obj.Email,
            role: obj.Roles || ""
          }));

      if (aNew.length === 0) {
        Toast.warning(this._t("WARN_NO_RECIPIENTS"));
        return;
      }

      const aMerged = [...(this._oState.getProperty("/recipients") || [])];
      const mExisting = new Set(aMerged.map((r) => (r.email || "").toLowerCase()));

      let iAdded = 0;
      aNew.forEach((r) => {
        const sKey = (r.email || "").toLowerCase();
        if (!mExisting.has(sKey)) {
          aMerged.push(r);
          mExisting.add(sKey);
          iAdded++;
        }
      });

      this._oState.setProperty("/recipients", aMerged);
      this._updateHeaderBadges();
      this._clearTableSelections(oTable);
      Toast.success(this._t("MSG_RECIPIENTS_ADDED", [iAdded]));
      this._closeDialog(this._oRecipDialog);
    },

    onClearAllRecipients() {
      this._oState.setProperty("/recipients", []);
      this._updateHeaderBadges();
      Toast.info(this._t("MSG_RECIPIENTS_CLEARED"));
    },

    onRemoveAddedRecipient(oEvent) {
      this._removeStateItem(oEvent, "/recipients");
    },

    // ----------------------------------------------------------------
    // Диалог новостей
    // ----------------------------------------------------------------

    onOpenNewsDialog() {
      this._ensureDefaultModel();

      const prepareNewsDialogState = (oDialog) => {
        const oModel = oDialog.getModel("dialog");
        if (oModel) {
          oModel.setProperty("/selectedMode", "search");
        }
        const oTabs = Fragment.byId(this.getView().getId(), "newsTabs");
        if (oTabs) {
          oTabs.setSelectedKey("search");
        }
        this._clearTableSelections(this._oNewsTable);
        oDialog.open();
      };

      if (this._oNewsDialog) {
        prepareNewsDialogState(this._oNewsDialog);
        return;
      }

      const sViewId = this.getView().getId();
      loadDialogOnce(this, "_oNewsDialog", "_pNewsDialogLoading",
        "MAILING_CONSTRUCTOR.view.fragment.NewsSearch", (oDialog) => {
          this._oNewsSmartTable = Fragment.byId(sViewId, "newsSmartTable");
          this._oNewsTable = Fragment.byId(sViewId, "newsTable");

          const oModel = new JSONModel({ selectedMode: "search" });
          oModel.setSizeLimit(1000);
          oDialog.setModel(oModel, "dialog");

          oDialog.attachAfterClose(() => {
            this._clearTableSelections(this._oNewsTable);
          });
        }).then((oDialog) => {
          prepareNewsDialogState(oDialog);
        }).catch((err) => {
          Log.error("[MAILING_CONSTRUCTOR] Failed to load NewsSearch fragment: " + (err?.message || err));
        });
    },

    onNewsTabSelect(oEvent) {
      const sKey = oEvent.getParameter("key") || oEvent.getParameter("selectedKey");
      const oModel = this._oNewsDialog?.getModel("dialog");
      if (oModel && sKey) {
        oModel.setProperty("/selectedMode", sKey);
      }
    },

    onAddSelectedNews() {
      if (!this._oNewsDialog) { return; }
      const oTable = this._oNewsSmartTable ? this._oNewsSmartTable.getTable() : this._oNewsTable;
      if (!oTable) { return; }

      const aSelected = oTable.getSelectedContexts().map((ctx) => ctx.getObject()).filter(Boolean);
      aSelected.forEach((item) => this._addNewsAsSource(item));

      if (aSelected.length > 0) {
        Toast.success(this._t("MSG_NEWS_ADDED", [aSelected.length]));
      }

      this._clearTableSelections(oTable);
      this._closeDialog(this._oNewsDialog);
    },

    onClearAllNews() {
      const aNews = [...(this._oState.getProperty("/newsItems") || [])];
      aNews.forEach((item) => {
        if (item.sourceId && this._oEditor) {
          this._oEditor.removeSource(item.sourceId);
        }
      });
      this._oState.setProperty("/newsItems", []);
      this._updateHeaderBadges();
      Toast.info(this._t("MSG_NEWS_CLEARED"));
    },

    // ----------------------------------------------------------------
    // SmartFilterBar & Поиск
    // ----------------------------------------------------------------

    onSmartFilterSearch(oEvent) {
      const oSource = oEvent.getSource();
      const sId = oSource?.getId() || "";
      if (sId.includes("recipientSFB")) {
        this._searchRecipients();
      } else if (sId.includes("newsSFB")) {
        this._searchNews();
      } else if (sId.includes("mailingsSFB")) {
        this.onMailingsFilterSearch();
      }
    },

    _searchRecipients() {
      if (!this._oRecipDialog) { return; }
      const oDialogModel = this._oRecipDialog.getModel("dialog");
      const bDetailed = oDialogModel?.getProperty("/searchMode") === "detailed";
      const oSmartTable = bDetailed ? this._oRecipSmartTable : this._oRecipGroupedSmartTable;

      if (oSmartTable) {
        oSmartTable.rebindTable();
      } else {
        const oTable = bDetailed ? this._oRecipTable : this._oRecipGroupedTable;
        if (oTable) {
          const aFilters = buildSfbFilters(Fragment.byId(this.getView().getId(), "recipientSFB"), ["FullName", "Email"], bDetailed);
          applyItemsFilter(oTable, aFilters);
        }
      }
    },

    onBeforeRebindRecipientTable(oEvent) {
      const mParams = oEvent.getParameter("bindingParams");
      if (mParams) {
        mParams.filters = adaptSfbFiltersForMode(mParams.filters, true);
      }
    },

    onBeforeRebindRecipientGroupedTable(oEvent) {
      const mParams = oEvent.getParameter("bindingParams");
      if (mParams) {
        mParams.filters = adaptSfbFiltersForMode(mParams.filters, false);
      }
    },

    _searchNews() {
      if (!this._oNewsDialog) { return; }
      if (this._oNewsSmartTable) {
        this._oNewsSmartTable.rebindTable();
      } else if (this._oNewsTable) {
        const aFilters = buildSfbFilters(Fragment.byId(this.getView().getId(), "newsSFB"), [], true, (f) => f.sPath === "Title");
        applyItemsFilter(this._oNewsTable, aFilters);
      }
    },

    onBeforeRebindNewsTable(oEvent) {
      const mParams = oEvent.getParameter("bindingParams");
      if (mParams?.filters) {
        mParams.filters = mParams.filters.filter((f) => f.sPath !== "Title");
      }
    },

    // ----------------------------------------------------------------
    // Закрытие диалогов
    // ----------------------------------------------------------------

    _closeDialog(oTarget) {
  if (!oTarget) { return; }

  // 1. Если передали sap.ui.base.Event — извлекаем источник (кнопку)
  let oControl = typeof oTarget.getSource === "function" ? oTarget.getSource() : oTarget;

  // 2. Поднимаемся вверх по дереву родителей, пока не найдем sap.m.Dialog
  while (oControl && typeof oControl.isA === "function" && !oControl.isA("sap.m.Dialog")) {
    oControl = oControl.getParent();
  }

  // 3. Безопасно проверяем isOpen и вызываем close
  if (oControl && typeof oControl.close === "function") {
    const bIsOpen = typeof oControl.isOpen === "function" ? oControl.isOpen() : true;
    if (bIsOpen) {
      oControl.close();
    }
  }
},

onCancelDialog(oEvent) {
  this._closeDialog(oEvent);
}
  };
});