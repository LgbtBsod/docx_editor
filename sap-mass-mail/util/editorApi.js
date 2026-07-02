sap.ui.define([
  "sap/ui/richtexteditor/RichTextEditor",
  "sap/ui/richtexteditor/library",
  "sap/base/Log"
], (RichTextEditor, richtexteditorLibrary, Log) => {
  "use strict";

  /**
   * Editor API wrapper around sap.ui.richtexteditor.RichTextEditor (TinyMCE).
   * Isolates all iframe-level access required for drag&drop and source-block
   * removal; every attached listener is tracked and removed in destroy().
   *
   * @param {sap.ui.core.mvc.View} oView the view owning the editor
   * @param {string} sContainerId the id of the container control
   * @constructor
   * @alias emailbuilder.util.Editor
   */
  function Editor(oView, sContainerId) {
    this._oView = oView;
    this._sContainerId = sContainerId;
    this._oRte = null;
    this._bReady = false;
    /** @type {Array<{target:EventTarget,type:string,fn:EventListener}>} */
    this._aTrackedListeners = [];
    this._oEditorDoc = null;
    this._bDestroyed = false;
  }

  Editor.prototype.create = function () {
    return new Promise((resolve) => {
      try {
        const oContainer = this._oView.byId(this._sContainerId);
        if (!oContainer) {
          Log.error("[emailbuilder] Editor container not found: " + this._sContainerId);
          resolve(false);
          return;
        }

        const oRte = new RichTextEditor(this._oView.createId("rte"), {
          width: "100%",
          height: "100%",
          editable: true,
          // Library enum via module import — no global namespace access.
          editorType: richtexteditorLibrary.EditorType.TinyMCE4,
          customToolbar: true,
          showGroupFont: true,
          showGroupLink: true,
          showGroupInsert: true,
          showGroupClipboard: true,
          showGroupStructure: true,
          showGroupTextAlign: true,
          ready: () => {
            this._bReady = true;
            this._setupEditorDnDIfPending();
            resolve(true);
          }
        });

        if (typeof oContainer.addContent === "function") {
          oContainer.addContent(oRte);
        } else if (typeof oContainer.addItem === "function") {
          oContainer.addItem(oRte);
        } else if (typeof oContainer.addAggregation === "function") {
          oContainer.addAggregation("content", oRte);
        }
        this._oRte = oRte;
      } catch (e) {
        Log.error("[emailbuilder] Failed to create editor: " + e.message);
        resolve(false);
      }
    });
  };

  Editor.prototype._trackListener = function (oTarget, sType, fn) {
    this._aTrackedListeners.push({ target: oTarget, type: sType, fn: fn });
  };

  Editor.prototype._setupEditorDnDIfPending = function () {
    if (this._fnPendingDropHandler) {
      const fn = this._fnPendingDropHandler;
      this._fnPendingDropHandler = null;
      this._attachEditorDnD(fn);
    }
  };

  Editor.prototype._attachEditorDnD = function (fnHandler) {
    if (!this._oRte) { return; }
    try {
      const oDom = this._oRte.getDomRef ? this._oRte.getDomRef() : null;
      if (!oDom) { return; }
      const oIframe = oDom.querySelector("iframe");
      if (!oIframe || !oIframe.contentWindow) { return; }
      const oDoc = oIframe.contentWindow.document;

      const onDragOver = (e) => {
        e.preventDefault();
        if (e.dataTransfer) { e.dataTransfer.dropEffect = "copy"; }
        if (oDoc.body) { oDoc.body.classList.add("mce-drag-over"); }
      };
      const onDragLeave = (e) => {
        e.preventDefault();
        if (oDoc.body) { oDoc.body.classList.remove("mce-drag-over"); }
      };
      const onDrop = (e) => {
        e.preventDefault();
        if (oDoc.body) { oDoc.body.classList.remove("mce-drag-over"); }
        const files = (e.dataTransfer && e.dataTransfer.files) || [];
        if (files.length > 0 && fnHandler) {
          fnHandler(files);
        }
      };

      oDoc.addEventListener("dragover", onDragOver, false);
      oDoc.addEventListener("dragleave", onDragLeave, false);
      oDoc.addEventListener("drop", onDrop, false);

      this._trackListener(oDoc, "dragover", onDragOver);
      this._trackListener(oDoc, "dragleave", onDragLeave);
      this._trackListener(oDoc, "drop", onDrop);
      this._oEditorDoc = oDoc;
    } catch (e) {
      Log.warning("[emailbuilder] Editor DnD attach failed: " + e.message);
    }
  };

  Editor.prototype.setupDnD = function (fnHandler) {
    if (!this._oRte) { return; }
    if (this._bReady) {
      this._attachEditorDnD(fnHandler);
    } else {
      this._fnPendingDropHandler = fnHandler;
    }
  };

  /**
   * Returns the editor's current HTML content.
   *
   * Prefers the raw TinyMCE editor's getContent(): it resolves the
   * blob: object URLs TinyMCE substitutes for data: URI images (so large
   * embedded images serialize back to their original data: URI, not a
   * dead blob: reference that only resolves inside this tab). The
   * RichTextEditor wrapper's own getValue() does not perform this
   * resolution and silently drops such an image's src entirely — used
   * only as a fallback when the live TinyMCE instance can't be resolved.
   *
   * @returns {string} editor HTML
   */
  Editor.prototype.getValue = function () {
    const oTinymce = this._getTinymceEditor();
    if (oTinymce && typeof oTinymce.getContent === "function") {
      try {
        return oTinymce.getContent() || "";
      } catch (e) {
        Log.warning("[emailbuilder] TinyMCE getContent failed, falling back: " + e.message);
      }
    }
    if (!this._oRte) { return ""; }
    try {
      return this._oRte.getValue() || "";
    } catch (e) {
      return "";
    }
  };

  Editor.prototype.setValue = function (sHtml) {
    if (!this._oRte) { return; }
    try {
      this._oRte.setValue(sHtml || "");
    } catch (e) {
      Log.warning("[emailbuilder] Editor setValue failed: " + e.message);
    }
  };

  /**
   * Resolves the live TinyMCE editor instance for this control via the
   * global tinymce registry (tinymce.get(id)).
   *
   * NOTE: the per-iframe reference (iframe.contentWindow.tinymce) is NOT
   * usable here — TinyMCE4 only tracks activeEditor/editors[] on the
   * top-level `window.tinymce` singleton, so the iframe copy's
   * `.activeEditor` is always null. Using it silently forced insert() onto
   * its setValue()-concatenation fallback for every call, which corrupts
   * large data: URI images (observed: a mammoth-embedded PNG's whole `src`
   * attribute gets dropped, leaving only `alt`) instead of using TinyMCE's
   * own insertContent(), which correctly converts data: URIs to a
   * blob: reference backed by its blob cache.
   *
   * @returns {Object|null} tinymce.Editor instance or null
   * @private
   */
  Editor.prototype._getTinymceEditor = function () {
    if (!this._oRte || typeof window.tinymce === "undefined") { return null; }
    try {
      return window.tinymce.get(this._oRte.getId() + "-textarea") || null;
    } catch (e) {
      return null;
    }
  };

  Editor.prototype.insert = function (sHtml) {
    if (!this._oRte || !sHtml) { return; }
    const oTinymce = this._getTinymceEditor();
    if (oTinymce && typeof oTinymce.insertContent === "function") {
      try {
        oTinymce.insertContent(sHtml);
        return;
      } catch (e) {
        Log.warning("[emailbuilder] TinyMCE insertContent failed, falling back: " + e.message);
      }
    }
    try {
      const sCur = this._oRte.getValue() || "";
      this._oRte.setValue(sCur + sHtml);
    } catch (e) {
      Log.warning("[emailbuilder] Editor insert fallback failed: " + e.message);
    }
  };

  /**
   * Removes the source block <div id="eb-src-{id}"> from the editor.
   * Primary path: TinyMCE DOM API. Fallback: DOMParser on the RTE value —
   * a real HTML parser handles nested <div>s correctly (the former regex
   * fallback truncated blocks at the first closing tag).
   *
   * @param {string} sSourceId source id to remove
   */
  Editor.prototype.removeSource = function (sSourceId) {
    if (!this._oRte || !sSourceId) { return; }
    try {
      const sDomId = "eb-src-" + String(sSourceId).replace(/[^a-zA-Z0-9-]/g, "-");

      const oTinymce = this._getTinymceEditor();
      if (oTinymce && oTinymce.dom) {
        const oEl = oTinymce.dom.get(sDomId);
        if (oEl) {
          oTinymce.dom.remove(oEl);
          const sNewVal = oTinymce.getContent();
          if (sNewVal !== null) {
            this._oRte.setValue(sNewVal);
          }
          return;
        }
      }

      const oDoc = new DOMParser().parseFromString(this._oRte.getValue() || "", "text/html");
      const oEl = oDoc.getElementById(sDomId);
      if (oEl && oEl.parentNode) {
        oEl.parentNode.removeChild(oEl);
        this._oRte.setValue(oDoc.body.innerHTML);
      }
    } catch (e) {
      Log.warning("[emailbuilder] Editor removeSource failed: " + e.message);
    }
  };

  Editor.prototype.destroy = function () {
    if (this._bDestroyed) { return; }
    this._bDestroyed = true;

    this._aTrackedListeners.forEach((oEntry) => {
      try {
        oEntry.target.removeEventListener(oEntry.type, oEntry.fn, false);
      } catch (e) { /* ignore */ }
    });
    this._aTrackedListeners = [];
    this._oEditorDoc = null;

    if (this._oRte) {
      try { this._oRte.destroy(); } catch (e) { /* ignore */ }
      this._oRte = null;
    }
    this._bReady = false;
    this._fnPendingDropHandler = null;
    this._oView = null;
  };

  return Editor;
});
