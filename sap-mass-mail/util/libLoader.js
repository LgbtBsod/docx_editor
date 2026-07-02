sap.ui.define([
  "sap/base/Log"
], (Log) => {
  "use strict";

  /**
   * Lazy loader for third-party browser libraries (mammoth, pdf.js, marked).
   * Each URL is injected at most once; concurrent callers share one Promise.
   */
  const mPending = {};

  /**
   * Loads a script once and resolves when its global is available.
   *
   * @param {string} sUrl script URL (app-relative)
   * @param {function():boolean} fnCheck returns true when the lib is usable
   * @returns {Promise<void>} resolves when loaded
   */
  function load(sUrl, fnCheck) {
    if (fnCheck()) { return Promise.resolve(); }
    if (!mPending[sUrl]) {
      mPending[sUrl] = new Promise((resolve, reject) => {
        const oScript = document.createElement("script");
        oScript.src = sUrl;
        oScript.async = true;
        oScript.onload = () => {
          if (fnCheck()) {
            resolve();
          } else {
            reject(new Error("Library loaded but unusable: " + sUrl));
          }
        };
        oScript.onerror = () => {
          delete mPending[sUrl]; // allow retry on next use
          Log.error("[emailbuilder] Failed to load library: " + sUrl);
          reject(new Error("Failed to load " + sUrl));
        };
        document.head.appendChild(oScript);
      });
    }
    return mPending[sUrl];
  }

  return { load: load };
});
