sap.ui.define([
  "sap/base/Log",
  "MAILING_CONSTRUCTOR/util/constants"
], (Log, Constants) => {
  "use strict";

  // v3: attachments no longer persist their `base64` content alongside
  // metadata — see save(). v2 drafts (which may carry large base64 blobs)
  // are discarded by isValidDraft() on next load instead of migrated;
  // attachments get re-added from disk on resume.
  const SCHEMA_VERSION = 3;

  /**
   * Генерирует уникальный ключ для draft, изолированный по пользователю.
   * @param {string} [sUserId] опциональный userId
   * @returns {string} storage key
   * @private
   */
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

  /**
   * Validates the basic shape of a draft object loaded from storage.
   *
   * @param {object} oDraft parsed draft
   * @returns {boolean} true when shape matches the current schema
   * @private
   */
  function isValidDraft(oDraft) {
    if (!oDraft || typeof oDraft !== "object") { return false; }
    if (oDraft.schemaVersion !== SCHEMA_VERSION) { return false; }
    if (typeof oDraft.localId !== "string") { return false; }
    if (oDraft.attachments && !Array.isArray(oDraft.attachments)) { return false; }
    if (oDraft.sources && !Array.isArray(oDraft.sources)) { return false; }
    if (oDraft.newsItems && !Array.isArray(oDraft.newsItems)) { return false; }
    if (oDraft.subject && typeof oDraft.subject !== "string") { return false; }
    if (oDraft.content && typeof oDraft.content !== "string") { return false; }
    return true;
  }

  /**
   * Safely reads a string from localStorage. Returns null on any error or
   * when the key is absent.
   *
   * @param {string} [sUserId] user ID for key isolation
   * @returns {string|null} raw stored JSON or null
   * @private
   */
  function readRaw(sUserId) {
    try {
      const sKey = getStorageKey(sUserId);
      return localStorage.getItem(sKey);
    } catch (e) {
      Log.warning("[MAILING_CONSTRUCTOR] localStorage.getItem failed: " + e.message);
      return null;
    }
  }

  /**
   * Loads the stored draft, validating shape and schema version.
   *
   * @param {string} [sUserId] user ID for key isolation
   * @returns {object|null} draft object or null when absent/invalid
   */
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

  /**
   * Persists the given draft object to localStorage.
   *
   * Recipients are deliberately NOT persisted: they're personal data (names/
   * emails) and localStorage is unencrypted/machine-wide.
   *
   * Attachment `base64` payload is stripped — only metadata (id/name/size/
   * mimeType) needed to render the chip survives; the user re-adds the
   * actual file on resume.
   *
   * @param {object} oDraft draft payload
   * @param {string} [sUserId] user ID for key isolation
   * @returns {void}
   * @throws {Error} when storage write fails (e.g. quota exceeded)
   */
  function save(oDraft, sUserId) {
    if (!oDraft) { return; }

    const oData = {
      schemaVersion: SCHEMA_VERSION,
      localId:     oDraft.localId || "",
      subject:     oDraft.subject || "",
      content:     oDraft.content || "",
      // Strip `base64` — only metadata the chip needs survives; the file
      // is re-added from disk on resume.
      attachments: (Array.isArray(oDraft.attachments) ? oDraft.attachments : []).map((a) => ({
        id:       a.id,
        name:     a.name,
        size:     a.size,
        sizeStr:  a.sizeStr,
        mimeType: a.mimeType
        // NO base64 — too large for localStorage.
      })),
      sources:     Array.isArray(oDraft.sources) ? oDraft.sources : [],
      newsItems:   Array.isArray(oDraft.newsItems) ? oDraft.newsItems : [],
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

  /**
   * Removes the stored draft (if any).
   *
   * @param {string} [sUserId] user ID for key isolation
   * @returns {void}
   */
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

