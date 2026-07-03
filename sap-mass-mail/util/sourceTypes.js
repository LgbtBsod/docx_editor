sap.ui.define([
  "emailbuilder/util/fileTypes",
  "emailbuilder/util/sourceBlock"
], (FileTypes, SourceBlock) => {
  "use strict";

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
      if (sType === SourceBlock.TYPE.NEWS) { return "#0070f2"; }
      const oType = FileTypes.get(sExt);
      return oType ? oType.color : "#5b738b";
    }
  };
});
