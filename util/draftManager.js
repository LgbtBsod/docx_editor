sap.ui.define([
  "sap/base/Log",
  "MAILING_CONSTRUCTOR/util/constants"
], (Log, Constants) => {
  "use strict";

  // v4: draft scope cut down to subject + content only. Attachments,
  // recipients, sources and news items are never persisted — attachments
  // and sources/news are either large (base64) or link back to files/state
  // the user re-adds anyway, and a partially-restored chip that LOOKS
  // complete but silently carries no data was worse than not restoring it
  // at all. v3-and-earlier drafts (which may carry those fields) are
  // discarded by isValidDraft() on next load instead of migrated.
  const SCHEMA_VERSION = 4;

  function getStorageKey(sUserId) {
    if (!sUserId) {
      try {
        const oUser = sap.ushell && sap.ushell.Container
          ? sap.ushell.Container.getUser()
          : null;
        sUserId = oUser && oUser.getId ? oUser.getId() : "anonymous";
      } catch (e) {
        sUserId = "anonymous";
      }
    }
    return `${Constants.STORAGE.DRAFT_KEY_PREFIX}_${sUserId}`;
  }

  function isValidDraft(oDraft) {
    if (!oDraft || typeof oDraft !== "object") { return false; }
    if (oDraft.schemaVersion !== SCHEMA_VERSION) { return false; }
    if (typeof oDraft.localId !== "string") { return false; }
    if (oDraft.subject && typeof oDraft.subject !== "string") { return false; }
    if (oDraft.content && typeof oDraft.content !== "string") { return false; }
    return true;
  }

  function readRaw(sUserId) {
    try {
      const sKey = getStorageKey(sUserId);
      return localStorage.getItem(sKey);
    } catch (e) {
      Log.warning("[MAILING_CONSTRUCTOR] localStorage.getItem failed: " + e.message);
      return null;
    }
  }

  function load(sUserId) {
    const sRaw = readRaw(sUserId);
    if (!sRaw) { return null; }

    try {
      const oDraft = JSON.parse(sRaw);
      if (!isValidDraft(oDraft)) {
        Log.warning("[MAILING_CONSTRUCTOR] Draft schema mismatch; discarding.");
        try { localStorage.removeItem(getStorageKey(sUserId)); } catch (e) { /* ignore */ }
        return null;
      }
      return oDraft;
    } catch (e) {
      Log.warning("[MAILING_CONSTRUCTOR] Failed to parse draft: " + e.message);
      try { localStorage.removeItem(getStorageKey(sUserId)); } catch (e2) { /* ignore */ }
      return null;
    }
  }

  // Only localId/subject/content are kept. Recipients (personal data —
  // names/emails — on an unencrypted, machine-wide store) and attachments
  // (base64 payload, too large for localStorage) are deliberately never
  // persisted. Sources/news-item sidebar chips aren't persisted either —
  // their actual content already lives inside `content` (they're just
  // blocks in the editor HTML); only the sidebar bookkeeping list is lost
  // on restore, which the user re-adds by re-importing if they need it back.
  function save(oDraft, sUserId) {
    if (!oDraft) { return; }

    const oData = {
      schemaVersion: SCHEMA_VERSION,
      localId:     oDraft.localId || "",
      subject:     oDraft.subject || "",
      content:     oDraft.content || "",
      savedAt:     new Date().toISOString()
    };

    try {
      const sKey = getStorageKey(sUserId);
      localStorage.setItem(sKey, JSON.stringify(oData));
    } catch (e) {
      if (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED") {
        Log.warning("[MAILING_CONSTRUCTOR] localStorage quota exceeded");
        try {
          const sKey = getStorageKey(sUserId);
          localStorage.removeItem(sKey);
          localStorage.setItem(sKey, JSON.stringify(oData));
          Log.info("[MAILING_CONSTRUCTOR] Draft saved after cleanup");
        } catch (e2) {
          Log.error("[MAILING_CONSTRUCTOR] Failed to save draft: " + e2.message);
          throw new Error("Draft storage unavailable");
        }
      } else {
        Log.error("[MAILING_CONSTRUCTOR] Failed to save draft: " + e.message);
        throw e;
      }
    }
  }

  function clear(sUserId) {
    try {
      const sKey = getStorageKey(sUserId);
      localStorage.removeItem(sKey);
    } catch (e) {
      Log.warning("[MAILING_CONSTRUCTOR] Failed to clear draft: " + e.message);
    }
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    load: load,
    save: save,
    clear: clear,
    getStorageKey: getStorageKey
  };
});

