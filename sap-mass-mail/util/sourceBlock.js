sap.ui.define([
  "sap/base/security/encodeXML"
], (encodeXML) => {
  "use strict";

  /**
   * Source-block helpers.
   *
   * Design decision: content is wrapped in a plain <div> with an id
   * attribute of the form `eb-src-{sanitized-id}`. TinyMCE 4 strips
   * custom data-* attributes and HTML comments during sanitisation, but
   * preserves the id attribute and class names. The wrapper has NO
   * contenteditable="false", so content remains fully editable.
   *
   * removeSource() locates the div by id and removes it from the editor.
   */
  const SourceBlock = {

    /**
     * Sanitises a source id into a valid HTML id fragment.
     * Replaces any character that is not [a-zA-Z0-9-] with a hyphen.
     *
     * @param {string} sSourceId raw source id
     * @returns {string} safe id fragment
     * @private
     */
    _toSafeId(sSourceId) {
      return "eb-src-" + String(sSourceId || "").replace(/[^a-zA-Z0-9-]/g, "-");
    },

    /**
     * Wraps content in a div tagged with id="eb-src-{sanitized-id}".
     * No contenteditable restriction — content stays fully editable.
     *
     * @param {string} sSourceId unique source id
     * @param {string} sType source type ("news" | "file")
     * @param {string} sTitle block title (escaped, used as data attribute)
     * @param {string} sContent inner HTML (already-sanitized by caller)
     * @returns {string} wrapped HTML
     */
    wrap(sSourceId, sType, sTitle, sContent) {
      const sSafeId = this._toSafeId(sSourceId);
      const sClass = "eb-src-block source-" + (sType === "news" ? "news" : "file");
      return '<div id="' + sSafeId + '" class="' + sClass + '">'
        + (sContent || "")
        + '</div>';
    },

    /**
     * Wraps a single PDF page (text or image) as a source block fragment.
     *
     * @param {string} sSourceId source id (may be empty for page fragments)
     * @param {number} iPageNum 1-based page number
     * @param {string} sMode "text" | "images"
     * @param {string} sContent inner HTML
     * @returns {string} wrapped HTML
     */
    wrapPdfPage(sSourceId, iPageNum, sMode, sContent) {
      const sClass = sMode === "images" ? "pdf-page-image" : "pdf-page-text";
      const sSafePage = encodeXML(String(iPageNum));
      return '<div class="' + sClass + '" data-page="' + sSafePage + '">'
        + (sContent || "")
        + '</div>';
    },

    /**
     * Returns the DOM id that will be used for the given source id.
     * Exposed so the editor can locate the element for removal.
     *
     * @param {string} sSourceId source id
     * @returns {string} DOM element id
     */
    toDomId(sSourceId) {
      return this._toSafeId(sSourceId);
    }
  };

  return SourceBlock;
});
