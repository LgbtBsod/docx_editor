sap.ui.define([
  "MAILING_CONSTRUCTOR/util/constants"
], (Constants) => {
  "use strict";

  // Semantic color aliases from the COLORS SSOT — a recolour edits one
  // entry in constants.js, not a hex literal per file type here.
  const C = Constants.COLORS;

  /**
   * Single registry (SSOT) for every supported source file type:
   * processing handler, accepted mime types, list icon and color.
   * Adding a format = one entry here + one handler in fileProcessor.
   */
  const TYPES = {
    ".pdf": {
      handler: "pdf",
      mimes: ["application/pdf"],
      icon: "sap-icon://pdf-attachment", color: C.ERROR
    },
    ".docx": {
      handler: "docx",
      mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip", "application/msword", "application/octet-stream"],
      icon: "sap-icon://doc-attachment", color: C.INFO
    },
    ".doc": {
      handler: "text",
      mimes: ["application/msword", "application/octet-stream"],
      icon: "sap-icon://doc-attachment", color: C.INFO
    },
    ".txt": {
      handler: "text",
      mimes: ["text/plain"],
      icon: "sap-icon://document-text", color: C.SECONDARY
    },
    ".md": {
      handler: "markdown",
      mimes: ["text/markdown", "text/plain"],
      icon: "sap-icon://document-text", color: C.SECONDARY
    },
    ".html": {
      handler: "html",
      mimes: ["text/html"],
      icon: "sap-icon://internet-browser", color: C.WARNING
    },
    ".htm": {
      handler: "html",
      mimes: ["text/html"],
      icon: "sap-icon://internet-browser", color: C.WARNING
    },
    ".png": {
      handler: "image",
      mimes: ["image/png"],
      icon: "sap-icon://background", color: C.SUCCESS
    },
    ".jpg": {
      handler: "image",
      mimes: ["image/jpeg", "image/jpg"],
      icon: "sap-icon://background", color: C.SUCCESS
    },
    ".jpeg": {
      handler: "image",
      mimes: ["image/jpeg", "image/jpg"],
      icon: "sap-icon://background", color: C.SUCCESS
    },
    ".gif": {
      handler: "image",
      mimes: ["image/gif"],
      icon: "sap-icon://background", color: C.SUCCESS
    }
  };

  return {

    /**
     * Returns the type descriptor for a file extension.
     *
     * @param {string} sExt lowercase extension incl. dot, e.g. ".pdf"
     * @returns {object|null} descriptor or null when unsupported
     */
    get(sExt) {
      return TYPES[sExt] || null;
    },

    /**
     * Checks whether a mime type plausibly matches a file extension.
     * Unknown extensions are not vetoed here (process() rejects them).
     *
     * @param {string} sExt file extension
     * @param {string} sMime reported mime type
     * @returns {boolean} true when plausible
     */
    mimeMatches(sExt, sMime) {
      const oType = TYPES[sExt];
      if (!oType || !sMime) { return true; }
      return oType.mimes.indexOf(sMime) >= 0;
    }
  };
});
