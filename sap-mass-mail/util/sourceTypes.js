sap.ui.define([
  "MAILING_CONSTRUCTOR/util/fileTypes",
  "MAILING_CONSTRUCTOR/util/sourceBlock",
  "MAILING_CONSTRUCTOR/util/constants"
], (FileTypes, SourceBlock, Constants) => {
  "use strict";

  // Local alias — news entries use the brand primary, file-type fallback
  // (unknown extension) uses secondary text. Per-type colors still come
  // from the fileTypes registry SSOT (success/warning/error shades are
  // type semantics, not brand colors).
  const COLORS = Constants.COLORS;

  /**
   * Presentation helpers for source list entries.
   * Icon/color data comes from the fileTypes registry (SSOT).
   */
  return {

    icon(sType, sExt) {
      if (sType === SourceBlock.TYPE.NEWS) { return "sap-icon://notification"; }
      const oType = FileTypes.get(sExt);
      return oType ? oType.icon : "sap-icon://document";
    },

    color(sType, sExt) {
      if (sType === SourceBlock.TYPE.NEWS) { return COLORS.PRIMARY; }
      const oType = FileTypes.get(sExt);
      return oType ? oType.color : COLORS.SECONDARY;
    }
  };
});
