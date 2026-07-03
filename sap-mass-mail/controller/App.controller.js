sap.ui.define([
  "emailbuilder/controller/BaseController",
  "emailbuilder/util/toast",
  "sap/m/MessageBox",
  "sap/base/Log",
  "emailbuilder/util/service",
  "emailbuilder/util/draftManager",
  "emailbuilder/util/editorApi",
  "emailbuilder/util/dndManager",
  "emailbuilder/util/emailComposer",
  "emailbuilder/model/formatter",
  "emailbuilder/controller/DialogMixin",
  "emailbuilder/controller/SourcesMixin",
  "emailbuilder/util/constants",
  "emailbuilder/util/mockBackend"
], (
  BaseController, Toast, MessageBox, Log,
  Service, DraftManager, Editor, DnDManager, EmailComposer, Formatter,
  DialogMixin, SourcesMixin, Constants, MockBackend
) => {
  "use strict";

  return BaseController.extend("emailbuilder.controller.App",
    Object.assign({}, DialogMixin, SourcesMixin, {

    formatter: Formatter,

    onInit() {
      const oComp = this.getOwnerComponent();
      const oView = this.getView();

      // Inject the resource bundle before any model is attached to the view —
      // attaching "state" triggers an immediate formatter evaluation
      // (e.g. recipientsSummary/newsSummary), which would otherwise run with
      // no bundle and permanently stick to the hardcoded fallback text.
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

      // FIXED: Capture userId for draft isolation
      try {
        if (sap.ushell && sap.ushell.Container) {
          const oUser = sap.ushell.Container.getUser();
          if (oUser && oUser.getId) {
            this._sUserId = oUser.getId();
          }
        }
      } catch (e) {
        Log.warning("[emailbuilder] Could not determine user ID");
      }

      this._loadAllowedHosts();
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
      // FIXED: Explicit cleanup with isDestroyed check
      [this._oRecipDialog, this._oNewsDialog, this._oMailingsDialog,
       this._oPdfModeDialog, this._oHistoryViewDialog]
        .forEach((oDialog) => {
          if (oDialog && !oDialog.isDestroyed()) {
            oDialog.destroyContent();
            oDialog.destroy();
          }
        });

      this._oRecipDialog = this._oNewsDialog = this._oMailingsDialog =
        this._oPdfModeDialog = this._oHistoryViewDialog = null;

      if (this._oDnD)    { this._oDnD.destroy();    this._oDnD = null; }
      if (this._oEditor) { this._oEditor.destroy(); this._oEditor = null; }
      this._oState = this._oConfig = null;
      this._sUserId = null;

      BaseController.prototype.onExit.apply(this, arguments);
    },

    onSubjectChange(oEvent) {
      this._oState.setProperty("/viewingSubject", oEvent.getParameter("newValue") || "");
    },

    onCancelDialog(oEvent) {
      this._closeDialog(oEvent.getSource());
    },

    onSourceBrowse() {
      const oUploader = this.byId("sourceUploader");
      if (oUploader) { oUploader.openFileSelector(); }
    },

    onAttachmentBrowse() {
      const oUploader = this.byId("attachmentUploader");
      if (oUploader) { oUploader.openFileSelector(); }
    },

    // === SEND ===

    onSend()      { this._handleSend(false); },
    onTestSend()  { this._handleSend(true);  },
    onSaveDraft() { this._saveDraft(); },

    /**
     * Validates email addresses against unified Constants.VALIDATION.EMAIL_PATTERN.
     * FIXED: DRY — single source of truth for email validation.
     * @param {object[]} aRecipients array of recipient objects with email property
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

      // Send buttons are enabled-bound to {= !${state>/isSending} } in the
      // view — no direct control manipulation needed here.
      this._oState.setProperty("/isSending", true);

      const sSubject = this._oState.getProperty("/viewingSubject") ||
                       (bIsTest ? this._t("TEST_SUBJECT_DEFAULT") : "");

      const oComponent = this.getOwnerComponent();

      // FIXED: emailComposer now gets component for i18n (removed hardcoded Russian text)
      const sEmailHtml = EmailComposer.compose(
        this._oEditor.getValue() || "",
        this._oConfig.getProperty("/allowedHosts") || [],
        sSubject,
        oComponent
      );

      const aAttachments = this._oState.getProperty("/attachments") || [];

      // Test sends omit ToRecipients on the wire — the backend targets the
      // test send at the calling user itself, it doesn't need the mailing
      // list. The local mock record keeps the real recipient list (plus an
      // IsTest flag) purely so /preview can show what a test send actually
      // looked like; it's never sent to the OData service.
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
          // MSG_SENT carries a {0} placeholder for the LocalId
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
     * Single implementation for "after send" and "clear template".
     *
     * @private
     */
    _resetComposer() {
      this._oEditor.setValue("");
      this.getOwnerComponent().resetState();
      DraftManager.clear(this._sUserId);  // FIXED: User-isolated cleanup
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

    // === DRAFT ===

    _restoreDraft() {
      const oDraft = DraftManager.load(this._sUserId);  // FIXED: User-isolated load
      if (!oDraft) { return; }

      this._oState.setProperty("/localId", oDraft.localId);
      this._oState.setProperty("/viewingSubject", oDraft.subject || "");
      // Recipients are never persisted (see draftManager.js#save) — a
      // restored draft always starts with an empty recipient list.
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
        // Recipients intentionally excluded — see draftManager.js#save.
        DraftManager.save({
          localId:     this._oState.getProperty("/localId"),
          subject:     this._oState.getProperty("/viewingSubject") || "",
          content:     this._oEditor.getValue() || "",
          attachments: this._oState.getProperty("/attachments") || [],
          sources:     this._oState.getProperty("/sources")     || [],
          newsItems:   this._oState.getProperty("/newsItems")   || []
        }, this._sUserId);  // FIXED: User-isolated save
        Toast.success(this._t("DRAFT_SAVED"));
      } catch (e) {
        Log.error("[emailbuilder] Draft save failed: " + e.message);
        MessageBox.error(this._t("ERR_DRAFT_SAVE"), { title: this._t("ERR_TITLE") });
      }
    },

    // === DATA LOADING ===

    _loadAllowedHosts() {
      Service.getAllowedHosts(this.getOwnerComponent())
        .then((aHosts) => {
          this._oConfig.setProperty("/allowedHosts", (aHosts || []).map((h) => h.Host));
        })
        .catch(() => {
          // Fail closed: an empty allowlist rejects every external host
          // (see util/sanitize.js) instead of silently allowing all — but
          // that's a silent behavior change for the user (their own
          // company images/links now vanish on send) unless we say so.
          this._oConfig.setProperty("/allowedHosts", []);
          Toast.warning(this._t("MSG_ALLOWED_HOSTS_LOAD_FAILED"));
        });
    }
  }));
});
