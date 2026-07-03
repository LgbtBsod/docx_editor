sap.ui.define([
  "sap/base/security/encodeXML"
], (encodeXML) => {
  "use strict";

  // Single source of truth for the source-block DOM id prefix / CSS class /
  // type tags — editorApi.js (block scan, removal) and every caller that
  // tags a block (fileProcessor.js, SourcesMixin.js) must derive from these
  // instead of re-typing the literals, or a rename here silently breaks them.
  const ID_PREFIX = "eb-src-";
  const CSS_CLASS = "eb-src-block";
  const TYPE = { FILE: "file", NEWS: "news" };

  const SourceBlock = {

    ID_PREFIX: ID_PREFIX,
    CSS_CLASS: CSS_CLASS,
    TYPE: TYPE,

    _toSafeId(sSourceId) {
      return ID_PREFIX + String(sSourceId || "").replace(/[^a-zA-Z0-9-]/g, "-");
    },

    /**
     * Strips ID_PREFIX from a DOM id, e.g. "eb-src-abc" -> "abc". Returns
     * the input unchanged if it isn't prefixed.
     *
     * @param {string} sDomId DOM id of a source block
     * @returns {string} the source id
     */
    fromDomId(sDomId) {
      const s = String(sDomId || "");
      return s.indexOf(ID_PREFIX) === 0 ? s.slice(ID_PREFIX.length) : s;
    },

    wrap(sSourceId, sType, sContent) {
      const sSafeId = this._toSafeId(sSourceId);
      const sClass = CSS_CLASS + " source-" + (sType === TYPE.NEWS ? TYPE.NEWS : TYPE.FILE);

      // The trailing <p> inside the div guarantees a normal caret position after
      // content ending in a <table>/<img>; the <p> after the div stops TinyMCE from
      // merging the next block's text into this one on backspace (confirmed empirically).
      return '<div id="' + sSafeId + '" class="' + sClass + '">'
        + (sContent || "")
        + '<p>&nbsp;</p>'
        + '</div>'
        + '<p>&nbsp;</p>';
    },

    wrapPdfPage(sSourceId, iPageNum, sMode, sContent) {
      const sClass = sMode === "images" ? "pdf-page-image" : "pdf-page-text";
      const sSafePage = encodeXML(String(iPageNum));
      return '<div class="' + sClass + '" data-page="' + sSafePage + '">'
        + (sContent || "")
        + '</div>';
    },

    toDomId(sSourceId) {
      return this._toSafeId(sSourceId);
    }
  };

  return SourceBlock;
});
