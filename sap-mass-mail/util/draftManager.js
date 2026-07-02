sap.ui.define([
  "sap/base/Log",
  "emailbuilder/util/constants"
], (Log, Constants) => {
  "use strict";

  const SCHEMA_VERSION = 1;

  /**
   * Генерирует уникальный ключ для draft, изолированный по пользователю.
   * FIXED: Защита от утечки данных между пользователями при multi-user сценарии.
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
    if (oDraft.recipients && !Array.isArray(oDraft.recipients)) { return false; }
    if (oDraft.attachments && !Array.isArray(oDraft.attachments)) { return false; }
    if (oDraft.sources && !Array.isArray(oDraft.sources)) { return false; }
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
      Log.warning("[emailbuilder] localStorage.getItem failed: " + e.message);
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
        Log.warning("[emailbuilder] Draft schema mismatch; discarding.");
        try { localStorage.removeItem(getStorageKey(sUserId)); } catch (e) { /* ignore */ }
        return null;
      }
      return oDraft;
    } catch (e) {
      Log.warning("[emailbuilder] Failed to parse draft: " + e.message);
      try { localStorage.removeItem(getStorageKey(sUserId)); } catch (e2) { /* ignore */ }
      return null;
    }
  }

  /**
   * Persists the given draft object to localStorage.
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
      recipients:  Array.isArray(oDraft.recipients) ? oDraft.recipients : [],
      attachments: Array.isArray(oDraft.attachments) ? oDraft.attachments : [],
      sources:     Array.isArray(oDraft.sources) ? oDraft.sources : [],
      savedAt:     new Date().toISOString()
    };

    try {
      const sKey = getStorageKey(sUserId);
      localStorage.setItem(sKey, JSON.stringify(oData));
    } catch (e) {
      if (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED") {
        Log.warning("[emailbuilder] localStorage quota exceeded");
        try {
          const sKey = getStorageKey(sUserId);
          localStorage.removeItem(sKey);
          localStorage.setItem(sKey, JSON.stringify(oData));
          Log.info("[emailbuilder] Draft saved after cleanup");
        } catch (e2) {
          Log.error("[emailbuilder] Failed to save draft: " + e2.message);
          throw new Error("Draft storage unavailable");
        }
      } else {
        Log.error("[emailbuilder] Failed to save draft: " + e.message);
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
      Log.warning("[emailbuilder] Failed to clear draft: " + e.message);
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

