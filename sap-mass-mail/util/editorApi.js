sap.ui.define([
  "sap/ui/richtexteditor/RichTextEditor",
  "sap/ui/richtexteditor/library",
  "sap/base/Log",
  "MAILING_CONSTRUCTOR/util/sourceBlock"
], (RichTextEditor, richtexteditorLibrary, Log, SourceBlock) => {
  "use strict";

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
          Log.error("[MAILING_CONSTRUCTOR] Editor container not found: " + this._sContainerId);
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
        this._configureSpellcheck(oRte);

        if (typeof oContainer.addContent === "function") {
          oContainer.addContent(oRte);
        } else if (typeof oContainer.addItem === "function") {
          oContainer.addItem(oRte);
        } else if (typeof oContainer.addAggregation === "function") {
          oContainer.addAggregation("content", oRte);
        }
        this._oRte = oRte;
      } catch (e) {
        Log.error("[MAILING_CONSTRUCTOR] Failed to create editor: " + e.message);
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
   */
  Editor.prototype._configureTabKey = function (oRte) {
    oRte.attachBeforeEditorInit((oEvent) => {
      const mConfig = oEvent.getParameter("configuration");
      const fnOrigSetup = mConfig.setup;
      mConfig.setup = (editor) => {
        if (typeof fnOrigSetup === "function") { fnOrigSetup(editor); }
        editor.on("keydown", (e) => {
          if (e.key !== "Tab") { return; }
          const oNode = editor.selection && editor.selection.getNode();
          if (oNode && editor.dom.getParent(oNode, "table")) { return; }
          e.preventDefault();
          e.stopImmediatePropagation();
          editor.execCommand("mceInsertContent", false, "&emsp;&emsp;");
        });
      };
    });
  };

  /**
   * Enables native browser spellcheck inside the editor iframe.
   *
   * TinyMCE4 defaults browser_spellcheck to false, which routes spellcheck
   * through its own "spellchecker" plugin — a paid/server-backed service
   * that isn't configured here, so without this the editor never spell-checks
   * anything at all. Setting it true instead lets the iframe body's native
   * contenteditable spellcheck do the work (red squiggly underlines +
   * right-click suggestions) — no server, no extra plugin, no cost.
   */
  Editor.prototype._configureSpellcheck = function (oRte) {
    oRte.attachBeforeEditorInit((oEvent) => {
      oEvent.getParameter("configuration").browser_spellcheck = true;
    });
  };

  // ------------------------------------------------------------------
  // Iframe-swap / content-edit observation: keeps drag&drop bound to the
  // live iframe and reports which source blocks are still valid. Started
  // lazily by whichever of setupDnD()/setupSourceSyncWatch() is called
  // first.
  // ------------------------------------------------------------------

  // Always re-reads from the live DOM — never cached across calls.
  Editor.prototype._resolveEditorDoc = function () {
    if (!this._oRte || !this._oRte.getDomRef) { return null; }
    const oDom = this._oRte.getDomRef();
    const oIframe = oDom && oDom.querySelector("iframe");
    return (oIframe && oIframe.contentDocument) || null;
  };

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

  // Lets the caller detect blocks the user emptied or deleted by hand
  // directly in the editor, to keep the sidebar source list in sync.
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

  Editor.prototype._checkIframeSwap = function () {
    const oDoc = this._resolveEditorDoc();
    if (oDoc === this._oBoundDoc) { return; }
    this._rebindDnD(oDoc);
    this._rebindBodyObserver(oDoc);
  };

  Editor.prototype._rebindBodyObserver = function (oDoc) {
    if (this._oBodyObserver) {
      this._oBodyObserver.disconnect();
      this._oBodyObserver = null;
    }
    if (!oDoc || !oDoc.body || !this._fnSourceSyncHandler) { return; }

    // Immediate scan so callers see current state without waiting for the
    // first future edit.
    this._scanSourceBlocks(oDoc);

    this._oBodyObserver = new MutationObserver(() => this._scheduleScan(oDoc));
    this._oBodyObserver.observe(oDoc.body, { childList: true, subtree: true, characterData: true });
  };

  Editor.prototype._scheduleScan = function (oDoc) {
    if (this._iScanDebounce) { clearTimeout(this._iScanDebounce); }
    this._iScanDebounce = setTimeout(() => {
      this._iScanDebounce = null;
      this._scanSourceBlocks(oDoc);
    }, SCAN_DEBOUNCE_MS);
  };

  // Idempotent. childList: true only — the iframe swap this watches for is
  // always a direct child change of the RTE's root node, never nested.
  Editor.prototype._ensureContainerObserver = function () {
    if (this._oContainerObserver || !this._oRte || !this._oRte.getDomRef) { return; }
    const oContainerDom = this._oRte.getDomRef();
    if (!oContainerDom) { return; }

    this._checkIframeSwap();

    this._oContainerObserver = new MutationObserver(() => this._checkIframeSwap());
    this._oContainerObserver.observe(oContainerDom, { childList: true });
  };

  Editor.prototype.setupDnD = function (fnHandler) {
    if (!this._oRte || typeof fnHandler !== "function") { return; }
    this._fnDnDHandler = fnHandler;
    this._ensureContainerObserver();
  };

  Editor.prototype.setupSourceSyncWatch = function (fnHandler) {
    if (!this._oRte || typeof fnHandler !== "function") { return; }
    this._fnSourceSyncHandler = fnHandler;
    this._ensureContainerObserver();
  };

  // ------------------------------------------------------------------
  // Content API
  // ------------------------------------------------------------------

  // Prefers the raw TinyMCE editor's getContent(): it resolves the blob:
  // object URLs TinyMCE substitutes for data: URI images (so large embedded
  // images serialize back to their original data: URI, not a dead blob:
  // reference that only resolves inside this tab). The RichTextEditor
  // wrapper's own getValue() skips that resolution and silently drops such
  // an image's src entirely — used only as a fallback below.
  Editor.prototype.getValue = function () {
    const oTinymce = this._getTinymceEditor();
    if (oTinymce && typeof oTinymce.getContent === "function") {
      try {
        return oTinymce.getContent() || "";
      } catch (e) {
        Log.warning("[MAILING_CONSTRUCTOR] TinyMCE getContent failed, falling back: " + e.message);
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
      Log.warning("[MAILING_CONSTRUCTOR] Editor setValue failed: " + e.message);
    }
  };

  // Resolves via the global tinymce registry (tinymce.get(id)) — the
  // per-iframe reference (iframe.contentWindow.tinymce) is NOT usable here:
  // TinyMCE4 only tracks activeEditor/editors[] on the top-level
  // `window.tinymce` singleton, so the iframe copy's `.activeEditor` is
  // always null.
  Editor.prototype._getTinymceEditor = function () {
    if (!this._oRte || typeof window.tinymce === "undefined") { return null; }
    try {
      return window.tinymce.get(this._oRte.getId() + "-textarea") || null;
    } catch (e) {
      return null;
    }
  };

  // Appends at the very end rather than at the current selection — uploads
  // are additive, not cursor-targeted edits, and the browser has no valid
  // caret position after a wrapping block (e.g. a docx-rendered <table>).
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
        Log.warning("[MAILING_CONSTRUCTOR] TinyMCE insertContent failed, falling back: " + e.message);
      }
    }
    try {
      const sCur = this._oRte.getValue() || "";
      this._oRte.setValue(sCur + sHtml);
    } catch (e) {
      Log.warning("[MAILING_CONSTRUCTOR] Editor insert fallback failed: " + e.message);
    }
  };

  // Primary path: TinyMCE DOM API. Fallback: DOMParser on the RTE value — a
  // real HTML parser handles nested <div>s correctly (a regex-based
  // fallback would truncate blocks at the first closing tag).
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
      Log.warning("[MAILING_CONSTRUCTOR] Editor removeSource failed: " + e.message);
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
