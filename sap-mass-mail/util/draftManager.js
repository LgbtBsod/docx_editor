sap.ui.define([
  "sap/base/Log"
], (Log) => {
  "use strict";

  /**
   * localStorage-backed draft manager for the Email Builder.
   * Stores a single named draft under `STORAGE_KEY` with a schema version
   * so future changes can detect and discard incompatible entries.
   */
  const STORAGE_KEY = "eb_draft_v1";
  const SCHEMA_VERSION = 1;

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
   * @returns {string|null} raw stored JSON or null
   * @private
   */
  function readRaw() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      // Safari private mode / disabled storage can throw on getItem
      Log.warning("[emailbuilder] localStorage.getItem failed: " + e.message);
      return null;
    }
  }

  /**
   * Loads the stored draft, validating shape and schema version.
   *
   * @returns {object|null} draft object or null when absent/invalid
   */
  function load() {
    const sRaw = readRaw();
    if (!sRaw) { return null; }
    try {
      const oDraft = JSON.parse(sRaw);
      if (!isValidDraft(oDraft)) {
        Log.warning("[emailbuilder] Draft schema mismatch; discarding stored draft.");
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        return null;
      }
      return oDraft;
    } catch (e) {
      Log.warning("[emailbuilder] Failed to parse draft: " + e.message);
      try { localStorage.removeItem(STORAGE_KEY); } catch (e2) { /* ignore */ }
      return null;
    }
  }

  /**
   * Persists the given draft object to localStorage.
   *
   * @param {object} oDraft draft payload
   * @returns {void}
   * @throws {Error} when storage write fails (e.g. quota exceeded)
   */
  function save(oDraft) {
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(oData));
    } catch (e) {
      if (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED") {
        Log.warning("[emailbuilder] localStorage quota exceeded, attempting to clear old data");
        try {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(oData));
          Log.info("[emailbuilder] Draft saved after clearing old storage");
        } catch (e2) {
          Log.error("[emailbuilder] Failed to save draft even after clearing: " + e2.message);
          throw new Error("Draft storage unavailable. Changes will be lost on page refresh.");
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
   * @returns {void}
   */
  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      Log.warning("[emailbuilder] Failed to clear draft: " + e.message);
    }
  }

  const DraftManager = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STORAGE_KEY: STORAGE_KEY,
    load: load,
    save: save,
    clear: clear
  };

  return DraftManager;
});
