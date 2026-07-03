sap.ui.define([
  "sap/base/security/encodeXML"
], (encodeXML) => {
  "use strict";

  const SourceBlock = {

    _toSafeId(sSourceId) {
      return "eb-src-" + String(sSourceId || "").replace(/[^a-zA-Z0-9-]/g, "-");
    },

    wrap(sSourceId, sType, sContent) {
      const sSafeId = this._toSafeId(sSourceId);
      const sClass = "eb-src-block source-" + (sType === "news" ? "news" : "file");

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
