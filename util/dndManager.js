sap.ui.define([
  "sap/base/Log"
], (Log) => {
  "use strict";

  // Every listener is tracked per zone so detachAll() can remove them cleanly.
  function DnDManager() {
    this._aZones = [];
  }

  DnDManager.prototype.attachZone = function (oDomRef, fnHandler, sKind) {
    if (!oDomRef) {
      Log.warning("[MAILING_CONSTRUCTOR] DnDManager.attachZone: missing oDomRef");
      return;
    }
    if (typeof fnHandler !== "function") {
      Log.warning("[MAILING_CONSTRUCTOR] DnDManager.attachZone: missing fnHandler");
      return;
    }

    const oZone = {
      dom: oDomRef,
      kind: sKind || "source",
      onDragEnter: (e) => {
        e.preventDefault();
        e.stopPropagation();
        oDomRef.classList.add("drag-over");
      },
      onDragOver: (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = "copy";
        }
      },
      onDragLeave: (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.target === oDomRef) {
          oDomRef.classList.remove("drag-over");
        }
      },
      onDrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        oDomRef.classList.remove("drag-over");
        const files = (e.dataTransfer && e.dataTransfer.files) || [];
        if (files.length > 0) {
          fnHandler(files);
        }
      }
    };

    oDomRef.addEventListener("dragenter", oZone.onDragEnter, false);
    oDomRef.addEventListener("dragover", oZone.onDragOver, false);
    oDomRef.addEventListener("dragleave", oZone.onDragLeave, false);
    oDomRef.addEventListener("drop", oZone.onDrop, false);

    this._aZones.push(oZone);
  };

  DnDManager.prototype.detachAll = function () {
    this._aZones.forEach((oZone) => this._removeZone(oZone));
    this._aZones = [];
  };

  DnDManager.prototype._removeZone = function (oZone) {
    try {
      oZone.dom.removeEventListener("dragenter", oZone.onDragEnter, false);
      oZone.dom.removeEventListener("dragover", oZone.onDragOver, false);
      oZone.dom.removeEventListener("dragleave", oZone.onDragLeave, false);
      oZone.dom.removeEventListener("drop", oZone.onDrop, false);
      oZone.dom.classList.remove("drag-over");
    } catch (e) { /* ignore */ }
  };

  DnDManager.prototype.destroy = function () {
    this.detachAll();
  };

  return DnDManager;
});
