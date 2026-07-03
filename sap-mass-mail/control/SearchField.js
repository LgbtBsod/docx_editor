sap.ui.define([
  "sap/m/VBox",
  "sap/m/Label"
], (VBox, Label) => {
  "use strict";

  // Explicit   escape, not a literal character in the source: a literal
  // non-breaking space is visually indistinguishable from a regular space
  // in an editor/diff and silently degrades to one on a re-save — which is
  // exactly what broke this the first time (a plain " " collapses to 0px
  // height here, since it's the sole content of the element and normal
  // CSS whitespace-collapsing removes it entirely).
  const SPACER_TEXT = " ";

  /**
   * One cell of a search-filter row: a small-caps label above a field
   * control (Input/Select/Button), used as a direct child of
   * sap.ui.layout.Grid in the dialog search tabs (NewsSearch,
   * RecipientSearch).
   *
   * Centralizes a pattern that used to be hand-copied VBox+Label markup in
   * every tab and once already caused a real bug: the search button had no
   * label above it, so its row came out shorter than the labeled fields
   * and sat visibly misaligned. Every SearchField — labeled or not (the
   * button cell passes no label) — renders the same label-then-field
   * structure, so every cell in a row is the same height by construction
   * instead of by every caller remembering to add a spacer.
   *
   * No custom aggregation here on purpose: VBox's own "items" (its
   * inherited default aggregation) already does the job — the label is
   * added first in init(), and the field control declared as the XML
   * child lands right after it via the standard default-aggregation
   * mechanism. An earlier version wrapped this in a dedicated "field"
   * aggregation with a hand-written setField() that called
   * this.setAggregation("field", ...) from inside itself — that re-enters
   * the very setter it's running inside of, so UI5 silently drops the
   * value every time. Aggregation forwarding to fix that (targeting
   * "items" on the control itself) hangs instead, since self-forwarding
   * isn't a supported shape. Not reinventing VBox's own aggregation
   * avoids both failure modes.
   *
   * @extends sap.m.VBox
   * @alias emailbuilder.control.SearchField
   */
  return VBox.extend("emailbuilder.control.SearchField", {
    renderer: "sap.m.VBoxRenderer", // reuse VBox's own rendering — no visual identity of our own
    metadata: {
      properties: {
        /** Field label text. Omit for an unlabeled cell (e.g. a button) —
         *  it still renders a spacer so the row height matches. */
        label: { type: "string", defaultValue: "" }
      }
    },

    init() {
      VBox.prototype.init.apply(this, arguments);
      this.addStyleClass("ebSearchInput");
      this._oLabel = new Label({ text: SPACER_TEXT }).addStyleClass("ebFieldLabel");
      this.addItem(this._oLabel);
    },

    setLabel(sLabel) {
      this.setProperty("label", sLabel, true);
      this._oLabel.setText(sLabel || SPACER_TEXT);
      return this;
    },

    destroy() {
      this._oLabel = null;
      VBox.prototype.destroy.apply(this, arguments);
    }
  });
});
