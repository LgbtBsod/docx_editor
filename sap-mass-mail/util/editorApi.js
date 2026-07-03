sap.ui.define([
  "sap/ui/richtexteditor/RichTextEditor",
  "sap/ui/richtexteditor/library",
  "sap/base/Log",
  "emailbuilder/util/sourceBlock"
], (RichTextEditor, richtexteditorLibrary, Log, SourceBlock) => {
  "use strict";

  /** Debounce for the source-block scan after the iframe body mutates (ms). */
  const SCAN_DEBOUNCE_MS = 300;

  /**
   * Editor API wrapper around sap.ui.richtexteditor.RichTextEditor (TinyMCE).
   *
   * Everything that reaches into the editor's iframe is funneled through
   * two places:
   *  - _getTinymceEditor(): resolved fresh via the global tinymce registry
   *    on every call, used by the synchronous API (insert/getValue/
   *    removeSource/setValue). Cheap, and correct by construction — there
   *    is no stale-reference class of bug possible here.
   *  - a pair of MutationObservers: the RichTextEditor control can replace
   *    its internal iframe/tinymce instance shortly after "ready" fires
   *    (custom-toolbar setup finishes asynchronously), which silently
   *    orphans anything bound to the iframe/instance captured at that
   *    moment — confirmed empirically. A container-level observer
   *    (_oContainerObserver) watches for that swap and re-resolves the
   *    live iframe the instant it happens; a body-level observer
   *    (_oBodyObserver) re-attached to whichever iframe is currently live
   *    reports content edits for the source-block validity scan. Both are
   *    event-driven — no background timer running while the user is idle.
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
    this._bDestroyed = false;

    // Iframe-swap / content-edit observation state.
    this._oContainerObserver = null; // watches the RTE's own DOM for iframe replacement
    this._oBodyObserver = null;      // watches the *live* iframe's body for content edits
    this._iScanDebounce = null;
    this._oBoundDoc = null;          // iframe document DnD listeners are bound to
    this._aBoundDnDListeners = [];   // [{type, fn}] currently attached to _oBoundDoc
    this._fnDnDHandler = null;       // caller's drop(files) callback
    this._fnSourceSyncHandler = null; // caller's sync(validIds) callback
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
          showGroupUndo: true,
          ready: () => {
            this._bReady = true;
            // Paragraph-style dropdown (Normal/Heading 1-6) and table
            // insertion aren't exposed via showGroupXxx — the control's
            // own shorthand for its "styleselect"/"table" button groups.
            oRte.addButtonGroup("styleselect");
            oRte.addButtonGroup("table");
            resolve(true);
          }
        });

        this._configureTabKey(oRte);

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

  /**
   * Makes Tab useful inside the editor instead of the default TinyMCE
   * "tabfocus" plugin behaviour, which moves focus to the next page
   * control the instant Tab is pressed anywhere in the content — a jarring
   * surprise for anyone typing prose and hitting Tab out of habit.
   *
   * Hooks TinyMCE's own setup(editor) callback (via beforeEditorInit,
   * chaining rather than replacing the control's existing setup) to insert
   * an indent and swallow the key everywhere except inside a table, where
   * TinyMCE's own table plugin already owns Tab for cell-to-cell
   * navigation and must run undisturbed.
   *
   * @param {sap.ui.richtexteditor.RichTextEditor} oRte the editor control,
   *   not yet rendered
   * @private
   */
  Editor.prototype._configureTabKey = function (oRte) {
    oRte.attachBeforeEditorInit((oEvent) => {
      const mConfig = oEvent.getParameter("configuration");
      const fnOrigSetup = mConfig.setup;
      mConfig.setup = (editor) => {
        if (typeof fnOrigSetup === "function") { fnOrigSetup(editor); }
        editor.on("keydown", (e) => {
          if (e.keyCode !== 9) { return; }
          const oNode = editor.selection && editor.selection.getNode();
          if (oNode && editor.dom.getParent(oNode, "table")) { return; }
          e.preventDefault();
          e.stopImmediatePropagation();
          editor.execCommand("mceInsertContent", false, "&emsp;&emsp;");
        });
      };
    });
  };

  // ------------------------------------------------------------------
  // Iframe-swap / content-edit observation: keeps drag&drop bound to the
  // live iframe and reports which source blocks are still valid. Started
  // lazily by whichever of setupDnD()/setupSourceSyncWatch() is called
  // first.
  // ------------------------------------------------------------------

  /**
   * Resolves the editor's current iframe document, or null if the editor
   * isn't rendered (yet, or anymore). Always re-reads from the live DOM —
   * never cached across calls.
   *
   * @returns {Document|null} the iframe's document
   * @private
   */
  Editor.prototype._resolveEditorDoc = function () {
    if (!this._oRte || !this._oRte.getDomRef) { return null; }
    const oDom = this._oRte.getDomRef();
    const oIframe = oDom && oDom.querySelector("iframe");
    return (oIframe && oIframe.contentDocument) || null;
  };

  /**
   * (Re-)binds the drag&drop listeners to the given iframe document,
   * detaching them from whatever document they were previously bound to.
   * A no-op when already bound to this exact document.
   *
   * @param {Document} oDoc the iframe document to bind to
   * @private
   */
  Editor.prototype._rebindDnD = function (oDoc) {
    if (oDoc === this._oBoundDoc) { return; }

    if (this._oBoundDoc) {
      this._aBoundDnDListeners.forEach((oEntry) => {
        try { this._oBoundDoc.removeEventListener(oEntry.type, oEntry.fn, false); } catch (e) { /* ignore */ }
      });
    }
    this._aBoundDnDListeners = [];
    this._oBoundDoc = oDoc;
    if (!oDoc || !this._fnDnDHandler) { return; }

    const fnHandler = this._fnDnDHandler;
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
      if (files.length > 0) { fnHandler(files); }
    };

    [["dragover", onDragOver], ["dragleave", onDragLeave], ["drop", onDrop]].forEach(([sType, fn]) => {
      oDoc.addEventListener(sType, fn, false);
      this._aBoundDnDListeners.push({ type: sType, fn: fn });
    });
  };

  /**
   * Scans for source blocks (<div id="eb-src-{id}">) still holding real
   * content and reports their ids to the source-sync handler. A block
   * counts as valid while it has text besides SourceBlock.wrap()'s
   * trailing filler paragraph, or media (image/table) of its own — used
   * by the caller to detect blocks the user emptied or deleted by hand
   * directly in the editor, keeping the sidebar source list in sync.
   *
   * @param {Document} oDoc the iframe document to scan
   * @private
   */
  Editor.prototype._scanSourceBlocks = function (oDoc) {
    if (!oDoc || !oDoc.body || !this._fnSourceSyncHandler) { return; }
    const aValidIds = [];
    oDoc.body.querySelectorAll("." + SourceBlock.CSS_CLASS + "[id]").forEach((oBlock) => {
      const sText = (oBlock.textContent || "").replace(/ /g, "").trim();
      if (sText || oBlock.querySelector("img, table")) {
        aValidIds.push(SourceBlock.fromDomId(oBlock.id));
      }
    });
    this._fnSourceSyncHandler(aValidIds);
  };

  /**
   * Reacts to a possible iframe swap: re-resolves the live iframe document
   * and, only when it actually differs from the one currently bound,
   * rebinds drag&drop and re-attaches the body observer to the new one.
   *
   * @private
   */
  Editor.prototype._checkIframeSwap = function () {
    const oDoc = this._resolveEditorDoc();
    if (oDoc === this._oBoundDoc) { return; }
    this._rebindDnD(oDoc);
    this._rebindBodyObserver(oDoc);
  };

  /**
   * (Re-)attaches the body-content observer to the given iframe document,
   * disconnecting it from whatever document it was previously watching.
   * Also runs one immediate scan so callers see the current state right
   * away instead of waiting for the first future edit.
   *
   * @param {Document} oDoc the iframe document to watch
   * @private
   */
  Editor.prototype._rebindBodyObserver = function (oDoc) {
    if (this._oBodyObserver) {
      this._oBodyObserver.disconnect();
      this._oBodyObserver = null;
    }
    if (!oDoc || !oDoc.body || !this._fnSourceSyncHandler) { return; }

    this._scanSourceBlocks(oDoc);

    this._oBodyObserver = new MutationObserver(() => this._scheduleScan(oDoc));
    this._oBodyObserver.observe(oDoc.body, { childList: true, subtree: true, characterData: true });
  };

  /**
   * Debounces _scanSourceBlocks so a burst of edit mutations (e.g. typing)
   * triggers one scan shortly after the user pauses, not one per keystroke.
   *
   * @param {Document} oDoc the iframe document to scan once settled
   * @private
   */
  Editor.prototype._scheduleScan = function (oDoc) {
    if (this._iScanDebounce) { clearTimeout(this._iScanDebounce); }
    this._iScanDebounce = setTimeout(() => {
      this._iScanDebounce = null;
      this._scanSourceBlocks(oDoc);
    }, SCAN_DEBOUNCE_MS);
  };

  /**
   * Starts the container-level observer that detects the RichTextEditor
   * replacing its internal iframe (see the class doc comment). Idempotent.
   *
   * @private
   */
  Editor.prototype._ensureContainerObserver = function () {
    if (this._oContainerObserver || !this._oRte || !this._oRte.getDomRef) { return; }
    const oContainerDom = this._oRte.getDomRef();
    if (!oContainerDom) { return; }

    this._checkIframeSwap();

    this._oContainerObserver = new MutationObserver(() => this._checkIframeSwap());
    this._oContainerObserver.observe(oContainerDom, { childList: true, subtree: true });
  };

  /**
   * Registers a handler for files dropped directly onto the editor body.
   *
   * @param {function(FileList)} fnHandler called with the dropped files
   */
  Editor.prototype.setupDnD = function (fnHandler) {
    if (!this._oRte || typeof fnHandler !== "function") { return; }
    this._fnDnDHandler = fnHandler;
    this._ensureContainerObserver();
  };

  /**
   * Registers a handler that's told, on every content edit inside the live
   * iframe (debounced), which source block ids are still valid (see
   * _scanSourceBlocks). The caller reconciles its own source/news lists
   * against that set.
   *
   * @param {function(string[])} fnHandler called with the still-valid ids
   */
  Editor.prototype.setupSourceSyncWatch = function (fnHandler) {
    if (!this._oRte || typeof fnHandler !== "function") { return; }
    this._fnSourceSyncHandler = fnHandler;
    this._ensureContainerObserver();
  };

  // ------------------------------------------------------------------
  // Content API
  // ------------------------------------------------------------------

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
   * large data: URI images (observed: a docx-embedded PNG's whole `src`
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

  /**
   * Inserts HTML for a newly added source/news block.
   *
   * Always appends at the very end of the document rather than at
   * whatever the current selection happens to be: uploads are additive
   * ("add another source"), not cursor-targeted edits, and leaving this
   * to insertContent()'s default selection is actively wrong when the
   * previous source's content ends in a block element with nothing after
   * it (e.g. a docx that renders as a wrapping <table>) — the browser has
   * nowhere valid to park the caret except *inside* that table's last
   * cell, so the next insertContent() call would land there instead of
   * after it.
   *
   * @param {string} sHtml HTML to append
   */
  Editor.prototype.insert = function (sHtml) {
    if (!this._oRte || !sHtml) { return; }
    const oTinymce = this._getTinymceEditor();
    if (oTinymce && typeof oTinymce.insertContent === "function") {
      try {
        oTinymce.selection.select(oTinymce.getBody(), true);
        oTinymce.selection.collapse(false);
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
   * a real HTML parser handles nested <div>s correctly (a regex-based
   * fallback would truncate blocks at the first closing tag).
   *
   * @param {string} sSourceId source id to remove
   */
  Editor.prototype.removeSource = function (sSourceId) {
    if (!this._oRte || !sSourceId) { return; }
    try {
      const sDomId = SourceBlock.toDomId(sSourceId);

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

    if (this._oContainerObserver) {
      this._oContainerObserver.disconnect();
      this._oContainerObserver = null;
    }
    if (this._oBodyObserver) {
      this._oBodyObserver.disconnect();
      this._oBodyObserver = null;
    }
    if (this._iScanDebounce) {
      clearTimeout(this._iScanDebounce);
      this._iScanDebounce = null;
    }
    if (this._oBoundDoc) {
      this._aBoundDnDListeners.forEach((oEntry) => {
        try { this._oBoundDoc.removeEventListener(oEntry.type, oEntry.fn, false); } catch (e) { /* ignore */ }
      });
    }
    this._aBoundDnDListeners = [];
    this._oBoundDoc = null;
    this._fnDnDHandler = null;
    this._fnSourceSyncHandler = null;

    if (this._oRte) {
      try { this._oRte.destroy(); } catch (e) { /* ignore */ }
      this._oRte = null;
    }
    this._bReady = false;
    this._oView = null;
  };

  return Editor;
});
