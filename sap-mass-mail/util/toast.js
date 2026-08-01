/**
 * Semantic MessageToast wrapper.
 *
 * sap.m.MessageToast in UI5 1.71 LTS has NO built-in severity support and
 * does NOT accept a `class` mOptions entry (that was added in a later
 * version). The only way to colour a toast by severity in 1.71 is to
 * query the just-rendered DOM node and tag it with a CSS class — UI5
 * renders MessageToast synchronously into the static UI area, so the
 * node is reliably available immediately after .show() returns.
 *
 * We scope the querySelectorAll to the static UI area (sap-ui-static)
 * so it doesn't scan the whole document, and we only touch the LAST
 * .sapMMessageToast node — which is the one we just created.
 */
sap.ui.define([
  "sap/m/MessageToast"
], (MessageToast) => {
  "use strict";

  const CSS_CLASS = {
    success: "ebToastSuccess",
    warning: "ebToastWarning",
    error:   "ebToastError",
    info:    "ebToastInfo"
  };

  /**
   * Shows a toast tagged with a severity CSS class.
   *
   * @param {string} sMessage text to display
   * @param {string} sType one of "success" | "warning" | "error" | "info"
   * @param {object} [mOptions] additional sap.m.MessageToast.show options
   * @private
   */
  function show(sMessage, sType, mOptions) {
    const sClass = CSS_CLASS[sType] || CSS_CLASS.info;
    MessageToast.show(sMessage, mOptions);
    // UI5 1.71: MessageToast.show() renders synchronously into the static
    // UI area, so the just-created node is reliably the last .sapMMessageToast.
    // Scope to #sap-ui-static to avoid scanning the whole document.
    const oStatic = document.getElementById("sap-ui-static");
    const aToasts = oStatic
      ? oStatic.querySelectorAll(".sapMMessageToast")
      : document.querySelectorAll(".sapMMessageToast");
    const oEl = aToasts[aToasts.length - 1];
    if (oEl) { oEl.classList.add(sClass); }
  }

  return {
    show:    (sMessage, mOptions) => show(sMessage, "info", mOptions),
    success: (sMessage, mOptions) => show(sMessage, "success", mOptions),
    warning: (sMessage, mOptions) => show(sMessage, "warning", mOptions),
    error:   (sMessage, mOptions) => show(sMessage, "error", mOptions)
  };
});
