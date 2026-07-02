sap.ui.define([], () => {
  "use strict";

  /**
   * Single registry (SSOT) for every supported source file type:
   * processing handler, accepted mime types, list icon and color.
   * Adding a format = one entry here + one handler in fileProcessor.
   */
  const TYPES = {
    ".pdf": {
      handler: "pdf",
      mimes: ["application/pdf"],
      icon: "sap-icon://pdf-attachment", color: "#ee3939"
    },
    ".docx": {
      handler: "docx",
      mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip", "application/msword", "application/octet-stream"],
      icon: "sap-icon://doc-attachment", color: "#1d6fd1"
    },
    ".doc": {
      handler: "text",
      mimes: ["application/msword", "application/octet-stream"],
      icon: "sap-icon://doc-attachment", color: "#1d6fd1"
    },
    ".txt": {
      handler: "text",
      mimes: ["text/plain"],
      icon: "sap-icon://document-text", color: "#5b738b"
    },
    ".md": {
      handler: "markdown",
      mimes: ["text/markdown", "text/plain"],
      icon: "sap-icon://document-text", color: "#5b738b"
    },
    ".html": {
      handler: "html",
      mimes: ["text/html"],
      icon: "sap-icon://document-html", color: "#e76500"
    },
    ".htm": {
      handler: "html",
      mimes: ["text/html"],
      icon: "sap-icon://document-html", color: "#e76500"
    },
    ".png": {
      handler: "image",
      mimes: ["image/png"],
      icon: "sap-icon://background", color: "#36a41d"
    },
    ".jpg": {
      handler: "image",
      mimes: ["image/jpeg", "image/jpg"],
      icon: "sap-icon://background", color: "#36a41d"
    },
    ".jpeg": {
      handler: "image",
      mimes: ["image/jpeg", "image/jpg"],
      icon: "sap-icon://background", color: "#36a41d"
    },
    ".gif": {
      handler: "image",
      mimes: ["image/gif"],
      icon: "sap-icon://background", color: "#36a41d"
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
