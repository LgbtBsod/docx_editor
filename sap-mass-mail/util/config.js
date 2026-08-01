sap.ui.define([
  "sap/base/Log",
  "sap/ui/core/format/FileSizeFormat",
  "MAILING_CONSTRUCTOR/util/fileTypes"
], (Log, FileSizeFormat, FileTypes) => {
  "use strict";

  const LOCAL_ID_PREFIX = "MSG";

  let oFileSizeFormat = null;

  function getFileSizeFormat() {
    if (!oFileSizeFormat) {
      oFileSizeFormat = FileSizeFormat.getInstance({
        binaryFilesize: true,
        decimals: 1
      });
    }
    return oFileSizeFormat;
  }

  /**
   * Generates a pseudo-unique LocalId like MSG-YYYYMMDD-HHMMSS-mmm-xxxx.
   * Uses crypto.getRandomValues when available for better entropy.
   */
  function generateLocalId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const ms = String(d.getMilliseconds()).padStart(3, "0");

    let rnd = "";
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const aBytes = new Uint8Array(6);
      crypto.getRandomValues(aBytes);
      for (let i = 0; i < aBytes.length; i++) {
        rnd += aBytes[i].toString(36);
      }
      rnd = rnd.slice(0, 8);
    } else {
      rnd = Math.random().toString(36).slice(2, 10);
    }

    return `${LOCAL_ID_PREFIX}-${date}-${time}-${ms}-${rnd}`.toUpperCase();
  }

  /**
   * Generates a short unique source id.
   */
  function generateSourceId() {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const aBytes = new Uint8Array(8);
      crypto.getRandomValues(aBytes);
      let sUuid = "";
      for (let i = 0; i < aBytes.length; i++) {
        sUuid += ("0" + aBytes[i].toString(16)).slice(-2);
      }
      return "src-" + sUuid.slice(0, 16);
    }
    return "src-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Returns the lowercase file extension including the dot, e.g. ".pdf".
   */
  function getFileExt(sName) {
    if (!sName || typeof sName !== "string") { return ""; }
    const iIdx = sName.lastIndexOf(".");
    return iIdx >= 0 ? sName.slice(iIdx).toLowerCase() : "";
  }

  /**
   * Formats a byte count via the standard sap.ui.core.format.FileSizeFormat.
   */
  function formatFileSize(iBytes) {
    if (iBytes === null || iBytes === undefined) { return ""; }
    const n = Number(iBytes);
    if (isNaN(n)) { return ""; }
    try {
      return getFileSizeFormat().format(n);
    } catch (e) {
      Log.warning("[MAILING_CONSTRUCTOR] FileSizeFormat failed: " + e.message);
      return String(n);
    }
  }

  return {
    LOCAL_ID_PREFIX: LOCAL_ID_PREFIX,

    // Client-side limits — single source of truth.
    MAX_ATTACHMENT_SIZE: 5 * 1024 * 1024,
    MAX_SOURCE_SIZE: 10 * 1024 * 1024,
    MAX_ATTACHMENTS: 10,
    MAX_PDF_PAGES: 30,

    generateLocalId: generateLocalId,
    generateSourceId: generateSourceId,
    getFileExt: getFileExt,
    formatFileSize: formatFileSize,
    mimeMatchesExt: FileTypes.mimeMatches
  };
});
