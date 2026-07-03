/**
 * Semantic MessageToast wrapper — tags the toast DOM node with a color class
 * per severity so users can tell success/warning/error apart at a glance
 * (plain sap.m.MessageToast has no built-in state/severity support).
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

  function show(sMessage, sType, mOptions) {
    MessageToast.show(sMessage, mOptions);
    // MessageToast#show renders its popup into the static UI area
    // synchronously, so the just-created node is reliably the last one.
    const aToasts = document.querySelectorAll(".sapMMessageToast");
    const oEl = aToasts[aToasts.length - 1];
    if (oEl) { oEl.classList.add(CSS_CLASS[sType] || CSS_CLASS.info); }
  }

  return {
    show:    (sMessage, mOptions) => show(sMessage, "info", mOptions),
    success: (sMessage, mOptions) => show(sMessage, "success", mOptions),
    warning: (sMessage, mOptions) => show(sMessage, "warning", mOptions),
    error:   (sMessage, mOptions) => show(sMessage, "error", mOptions)
  };
});
