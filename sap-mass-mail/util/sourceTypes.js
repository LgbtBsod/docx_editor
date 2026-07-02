sap.ui.define([
  "emailbuilder/util/fileTypes"
], (FileTypes) => {
  "use strict";

  /**
   * Presentation helpers for source list entries.
   * Icon/color data comes from the fileTypes registry (SSOT).
   */
  return {

    icon(sType, sExt) {
      if (sType === "news") { return "sap-icon://notification"; }
      const oType = FileTypes.get(sExt);
      return oType ? oType.icon : "sap-icon://document";
    },

    color(sType, sExt) {
      if (sType === "news") { return "#0070f2"; }
      const oType = FileTypes.get(sExt);
      return oType ? oType.color : "#5b738b";
    }
  };
});
