sap.ui.define([
  "MAILING_CONSTRUCTOR/controller/BaseController",
  "MAILING_CONSTRUCTOR/util/toast",
  "sap/m/MessageBox",
  "sap/base/Log",
  "MAILING_CONSTRUCTOR/util/service",
  "MAILING_CONSTRUCTOR/util/draftManager",
  "MAILING_CONSTRUCTOR/util/editorApi",
  "MAILING_CONSTRUCTOR/util/dndManager",
  "MAILING_CONSTRUCTOR/util/emailComposer",
  "MAILING_CONSTRUCTOR/model/formatter",
  "MAILING_CONSTRUCTOR/controller/DialogMixin",
  "MAILING_CONSTRUCTOR/controller/SourcesMixin",
  "MAILING_CONSTRUCTOR/util/constants",
  "MAILING_CONSTRUCTOR/util/mockBackend"
], (
  BaseController, Toast, MessageBox, Log,
  Service, DraftManager, Editor, DnDManager, EmailComposer, Formatter,
  DialogMixin, SourcesMixin, Constants, MockBackend
) => {
  "use strict";

  // BaseController.extend(name, Object.assign({}, DialogMixin, SourcesMixin, {
  //   ...App's own methods...
  // })) flattens DialogMixin / SourcesMixin plus App's own methods into one
  // controller prototype (UI5 1.71 LTS has no first-class class composition).
  // LAST object wins for method name collisions; mixins share state via `this`.
  return BaseController.extend("MAILING_CONSTRUCTOR.controller.App",
    Object.assign({}, DialogMixin, SourcesMixin, {

    formatter: Formatter,

    onInit() {
      const oComp = this.getOwnerComponent();
      const oView = this.getView();

      // Inject the resource bundle before any model is attached to the view —
      // attaching "state" triggers an immediate formatter evaluation, which
      // would otherwise run with no bundle and permanently stick to the
      // hardcoded fallback text.
      Formatter.setResourceBundle(oComp.getModel("i18n").getResourceBundle());

      ["state", "config", "i18n", "constants"].forEach((sName) => {
        oView.setModel(oComp.getModel(sName), sName);
      });

      this._oState  = oComp.getModel("state");
      this._oConfig = oComp.getModel("config");
      this._oEditor = new Editor(oView, "editorContainer");
      this._oDnD    = new DnDManager();
      this._bFirstRenderDone = false;
      this._sUserId = null;

      // Capture userId for draft isolation (SAP Launchpad / SAP Fiori)
      try {
        if (sap.ushell && sap.ushell.Container) {
          const oUser = sap.ushell.Container.getUser();
          if (oUser && oUser.getId) {
            this._sUserId = oUser.getId();
          }
        }
      } catch (e) {
        Log.warning("[MAILING_CONSTRUCTOR] Could not determine user ID");
      }

      this._loadMailingConfig();
    },

    onAfterRendering() {
      if (this._bFirstRenderDone) { return; }
      this._bFirstRenderDone = true;

      this._oEditor.create().then((bReady) => {
        if (bReady) {
          this._oEditor.setupDnD((aFiles) => this._handleSourceDrop(aFiles));
          this._oEditor.setupSourceSyncWatch((aValidIds) => this._reconcileSourcesWithEditor(aValidIds));
        }
      });

      ["sourceDropZone", "attachmentDropZone"].forEach((sZoneId) => {
        const oControl = this.byId(sZoneId);
        const oDom = oControl && oControl.getDomRef && oControl.getDomRef();
        if (oDom) {
          this._oDnD.attachZone(oDom, (aFiles) => this._handleSourceDrop(aFiles), sZoneId);
        }
      });

      this._restoreDraft();
    },

    onExit() {
      // DialogMixin handles its own dialog cleanup
      if (typeof this.onExitCleanup === "function") {
        this.onExitCleanup();
      }

      if (this._oDnD)    { this._oDnD.destroy();    this._oDnD = null; }
      if (this._oEditor) { this._oEditor.destroy(); this._oEditor = null; }
      this._oState = this._oConfig = null;
      this._sUserId = null;

      BaseController.prototype.onExit.apply(this, arguments);
    },

    // ----------------------------------------------------------------
    // UI event handlers
    // ----------------------------------------------------------------

    onSubjectChange(oEvent) {
      this._oState.setProperty("/viewingSubject", oEvent.getParameter("newValue") || "");
    },

    onCancelDialog(oEvent) {
      this._closeDialog(oEvent.getSource());
    },

    onSourceBrowse() {
      // UI5 1.71 FileUploader has no openFileSelector() method (added in 1.84+).
      // The FileUploader with buttonOnly="true" already renders a native <input type="file">
      // — trigger its click() directly via the DOM. This is the standard 1.71 workaround.
      const oUploader = this.byId("sourceUploader");
      if (oUploader && oUploader.getDomRef) {
        const oInput = oUploader.getDomRef().querySelector("input[type='file']");
        if (oInput) { oInput.click(); }
      }
    },

    onAttachmentBrowse() {
      const oUploader = this.byId("attachmentUploader");
      if (oUploader && oUploader.getDomRef) {
        const oInput = oUploader.getDomRef().querySelector("input[type='file']");
        if (oInput) { oInput.click(); }
      }
    },

    /**
     * Copies the LocalId to the system clipboard.
     * Placed here (not in SourcesMixin) as it is a generic UI action,
     * not a source-management concern.
     */
    onCopyLocalId() {
      const sText = this._oState.getProperty("/localId") || "";
      if (sText && navigator && navigator.clipboard
          && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(sText)
          .then(() => Toast.success(this._t("MSG_LOCALID_COPIED")))
          .catch(() => { /* clipboard API may be blocked by browser policy */ });
      }
    },

    // ----------------------------------------------------------------
    // Send
    // ----------------------------------------------------------------

    onSend()      { this._handleSend(false); },
    onTestSend()  { this._handleSend(true);  },
    onSaveDraft() { this._saveDraft(); },

    /**
     * Validates email addresses against Constants.VALIDATION.EMAIL_PATTERN.
     *
     * @param {object[]} aRecipients
     * @returns {object} { valid: boolean, message: string }
     * @private
     */
    _validateEmails(aRecipients) {
      const aInvalid = aRecipients.filter(
        (r) => !Constants.VALIDATION.EMAIL_PATTERN.test(r.email)
      );
      if (aInvalid.length > 0) {
        const sEmails = aInvalid.map((r) => r.email).join(", ");
        return { valid: false, message: this._t("ERR_INVALID_EMAILS", [sEmails]) };
      }
      return { valid: true };
    },

    _handleSend(bIsTest) {
      if (this._oState.getProperty("/isSending")) { return; }

      const aRecipients = this._oState.getProperty("/recipients") || [];
      if (!bIsTest && aRecipients.length === 0) {
        MessageBox.warning(this._t("WARN_NO_RECIPIENTS"));
        return;
      }

      const oValidation = this._validateEmails(aRecipients);
      if (!oValidation.valid) {
        MessageBox.error(oValidation.message, { title: this._t("ERR_TITLE") });
        return;
      }

      this._oState.setProperty("/isSending", true);

      const sSubject = this._oState.getProperty("/viewingSubject") ||
                       (bIsTest ? this._t("TEST_SUBJECT_DEFAULT") : "");
      const oComponent = this.getOwnerComponent();

      const sEmailHtml = EmailComposer.compose(
        this._oEditor.getValue() || "",
        this._oConfig.getProperty("/allowedHosts") || [],
        sSubject,
        oComponent
      );

      const aAttachments = this._oState.getProperty("/attachments") || [];

      // Frontend deep-create payload. No `Status` field is sent —
      // zcl_eb_mailing_mod_builder=>build_deep is the SSOT for status on create.
      const oPayload = {
        LocalId:      this._oState.getProperty("/localId"),
        Subject:      sSubject,
        Content:      sEmailHtml,
        ToRecipients: bIsTest ? [] : aRecipients,
        Attachments:  aAttachments
      };

      Service.sendMailing(oComponent, oPayload, bIsTest)
        .then((data) => MockBackend.recordSend(oPayload, aRecipients, bIsTest).then(() => data))
        .then((data) => {
          if (this._oMailingsTable && this._oMailingsTable.getBinding) {
            var oBinding = this._oMailingsTable.getBinding("items");
            if (oBinding) { oBinding.refresh(); }
          }
          MessageBox.success(this._t(data.messageKey, [data.localId]), {
            title: this._t("SUCCESS_SENT_TITLE"),
            onClose: () => this._resetComposer()
          });
        })
        .catch((err) => {
          MessageBox.error(err.message || this._t("MSG_SEND_ERROR"), {
            title: this._t("ERR_TITLE")
          });
        })
        .then(() => {
          this._oState.setProperty("/isSending", false);
        });
    },

    /**
     * Resets the composer to a pristine draft (fresh LocalId, empty editor).
     * @private
     */
    _resetComposer() {
      this._oEditor.setValue("");
      this.getOwnerComponent().resetState();
      DraftManager.clear(this._sUserId);
    },

    onClearTemplate() {
      MessageBox.confirm(this._t("CONFIRM_CLEAR"), {
        title: this._t("CONFIRM_CLEAR_TITLE"),
        onClose: (action) => {
          if (action === MessageBox.Action.OK) {
            this._resetComposer();
            Toast.success(this._t("MSG_TEMPLATE_CLEARED"));
          }
        }
      });
    },

    // ----------------------------------------------------------------
    // Draft
    // ----------------------------------------------------------------

    _restoreDraft() {
      const oDraft = DraftManager.load(this._sUserId);
      if (!oDraft) { return; }

      this._oState.setProperty("/localId", oDraft.localId);
      this._oState.setProperty("/viewingSubject", oDraft.subject || "");
      this._oState.setProperty("/recipients", []);
      this._oState.setProperty("/attachments", oDraft.attachments || []);
      this._oState.setProperty("/sources", oDraft.sources || []);
      this._oState.setProperty("/newsItems", oDraft.newsItems || []);
      this._updateHeaderBadges();

      if (oDraft.content) { this._oEditor.setValue(oDraft.content); }
      Toast.success(this._t("DRAFT_RESTORED"));
    },

    _saveDraft() {
      try {
        DraftManager.save({
          localId:     this._oState.getProperty("/localId"),
          subject:     this._oState.getProperty("/viewingSubject") || "",
          content:     this._oEditor.getValue() || "",
          attachments: this._oState.getProperty("/attachments") || [],
          sources:     this._oState.getProperty("/sources")     || [],
          newsItems:   this._oState.getProperty("/newsItems")   || []
        }, this._sUserId);
        Toast.success(this._t("DRAFT_SAVED"));
      } catch (e) {
        Log.error("[MAILING_CONSTRUCTOR] Draft save failed: " + e.message);
        MessageBox.error(this._t("ERR_DRAFT_SAVE"), { title: this._t("ERR_TITLE") });
      }
    },

    // ----------------------------------------------------------------
    // Data loading
    // ----------------------------------------------------------------

    /**
     * Loads MaxRecipients/SubjectMaxLen from MailingConfigSet.
     * Failure is silently ignored — the pre-load fallback in util/constants.js
     * keeps the UI usable with client-side defaults.
     * @private
     */
    _loadMailingConfig() {
      const oComponent = this.getOwnerComponent();
      Service.getMailingConfig(oComponent)
        .then((oData) => {
          const iMaxRecipients = parseInt(oData.MaxRecipients, 10);
          const iSubjectMaxLen = parseInt(oData.SubjectMaxLen, 10);
          if (iMaxRecipients > 0) {
            this._oConfig.setProperty("/maxRecipients", iMaxRecipients);
            oComponent.setStateSizeLimit(iMaxRecipients);
          }
          if (iSubjectMaxLen > 0) {
            this._oConfig.setProperty("/subjectMaxLen", iSubjectMaxLen);
          }
        })
        .catch((e) => {
          Log.warning("[MAILING_CONSTRUCTOR] Mailing config load failed, using client-side fallback: " + e.message);
        });
    }
  }));
});