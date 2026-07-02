sap.ui.define([
  "emailbuilder/controller/BaseController",
  "sap/m/MessageToast",
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
  "emailbuilder/util/constants"
], (
  BaseController, MessageToast, MessageBox, Log,
  Service, DraftManager, Editor, DnDManager, EmailComposer, Formatter,
  DialogMixin, SourcesMixin, Constants
) => {
  "use strict";

  return BaseController.extend("emailbuilder.controller.App",
    Object.assign({}, DialogMixin, SourcesMixin, {

    formatter: Formatter,

    onInit() {
      const oComp = this.getOwnerComponent();
      const oView = this.getView();

      ["state", "config", "hud", "i18n"].forEach((sName) => {
        oView.setModel(oComp.getModel(sName), sName);
      });

      Formatter.setResourceBundle(oComp.getModel("i18n").getResourceBundle());

      this._oState  = oComp.getModel("state");
      this._oConfig = oComp.getModel("config");
      this._oHud    = oComp.getModel("hud");
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
      this._oState = this._oConfig = this._oHud = null;
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

      const oPayload = {
        LocalId:      this._oState.getProperty("/localId"),
        Subject:      sSubject,
        Content:      sEmailHtml,
        ToRecipients: bIsTest ? [] : aRecipients,
        Attachments:  this._oState.getProperty("/attachments") || []
      };

      Service.sendMailing(oComponent, oPayload, bIsTest)
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
     * Resets the composer to a pristine draft (fresh LocalId, empty editor,
     * empty HUD). Single implementation for "after send", "clear template"
     * and "back to current".
     *
     * @private
     */
    _resetComposer() {
      this._oEditor.setValue("");
      this.getOwnerComponent().resetState();
      this._oHud.setData({ statuses: [], total: 0 });
      DraftManager.clear(this._sUserId);  // FIXED: User-isolated cleanup
    },

    onClearTemplate() {
      MessageBox.confirm(this._t("CONFIRM_CLEAR"), {
        title: this._t("CONFIRM_CLEAR_TITLE"),
        onClose: (action) => {
          if (action === MessageBox.Action.OK) {
            this._resetComposer();
            MessageToast.show(this._t("MSG_TEMPLATE_CLEARED"));
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
      this._oState.setProperty("/recipients", oDraft.recipients || []);
      this._oState.setProperty("/attachments", oDraft.attachments || []);
      this._oState.setProperty("/sources", oDraft.sources || []);
      this._updateHeaderBadges();

      if (oDraft.content) { this._oEditor.setValue(oDraft.content); }
      MessageToast.show(this._t("DRAFT_RESTORED"));
    },

    _saveDraft() {
      try {
        DraftManager.save({
          localId:     this._oState.getProperty("/localId"),
          subject:     this._oState.getProperty("/viewingSubject") || "",
          content:     this._oEditor.getValue() || "",
          recipients:  this._oState.getProperty("/recipients")  || [],
          attachments: this._oState.getProperty("/attachments") || [],
          sources:     this._oState.getProperty("/sources")     || []
        }, this._sUserId);  // FIXED: User-isolated save
        MessageToast.show(this._t("DRAFT_SAVED"));
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
          // (see util/sanitize.js) instead of silently allowing all.
          this._oConfig.setProperty("/allowedHosts", []);
        });
    }
  }));
});
