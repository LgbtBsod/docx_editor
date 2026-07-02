sap.ui.define([
  "sap/base/Log"
], (Log) => {
  "use strict";

  /**
   * Drag & Drop manager. Attaches native HTML5 drag events to a DOM zone
   * and calls a callback with the dropped FileList. Every listener is
   * tracked so `detachAll()` can remove them cleanly.
   *
   * @constructor
   * @alias emailbuilder.util.DnDManager
   */
  function DnDManager() {
    this._aZones = [];
  }

  /**
   * Attaches drag&drop handlers to a DOM zone.
   *
   * @param {HTMLElement} oDomRef DOM element to attach to
   * @param {Function} fnHandler receives the dropped FileList
   * @param {string} [sKind="source"] zone kind label (informational)
   */
  DnDManager.prototype.attachZone = function (oDomRef, fnHandler, sKind) {
    if (!oDomRef) {
      Log.warning("[emailbuilder] DnDManager.attachZone: missing oDomRef");
      return;
    }
    if (typeof fnHandler !== "function") {
      Log.warning("[emailbuilder] DnDManager.attachZone: missing fnHandler");
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
