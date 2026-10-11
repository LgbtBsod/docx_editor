// i18n bundle comes from the caller's component (App.controller); brand
// colors come from Constants.COLORS.
sap.ui.define([
  "sap/base/security/encodeXML",
  "MAILING_CONSTRUCTOR/util/sanitize",
  "MAILING_CONSTRUCTOR/util/constants",
  "sap/base/Log"
], (encodeXML, Sanitize, Constants, Log) => {
  "use strict";

  // Local alias so the template literals below stay readable — the SSOT
  // entry itself lives in util/constants.js COLORS. A recolour edits one
  // line there, not three style attributes here.
  const COLORS = Constants.COLORS;

  let oBundle = null;

  function ensureBundle(oComponent) {
    if (oBundle) { return oBundle; }
    try {
      if (oComponent) {
        const oI18nModel = oComponent.getModel("i18n");
        if (oI18nModel) {
          oBundle = oI18nModel.getResourceBundle();
        }
      }
    } catch (e) {
      Log.warning("[MAILING_CONSTRUCTOR] Failed to load i18n bundle");
    }
    return oBundle;
  }

  function getText(sKey, sFallback, oComponent) {
    const oB = ensureBundle(oComponent);
    if (oB) {
      try {
        const sText = oB.getText(sKey);
        if (sText && sText !== sKey) { return sText; }
      } catch (e) { /* fall through */ }
    }
    return sFallback || sKey;
  }

  // Text fields (sTitle, sFooter) go through encodeXML() (escape special
  // chars, render as literal text); HTML content (sBody) goes through
  // Sanitize.forEmail() (allow tags, strip XSS) — mixing these up in either
  // direction is a real injection risk, so keep the split explicit.
  const EmailComposer = {
    compose(sEditorHtml, aAllowedHosts, sSubject, oComponent) {
      const sBody = Sanitize.forEmail(sEditorHtml || "", aAllowedHosts);
      const sTitle = sSubject
        ? encodeXML(sSubject)
        : "";

      const sFooterText = getText(
        "EMAIL_FOOTER",
        "This message was sent by the mailing system.",
        oComponent
      );
      const sFooter = encodeXML(sFooterText);

      const aParts = [
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:' + COLORS.TEXT + ';max-width:680px;margin:0 auto;">'
      ];

      if (sTitle) {
        aParts.push(
          '<h2 style="margin:0 0 16px;color:' + COLORS.TEXT + ';border-bottom:2px solid ' + COLORS.PRIMARY + ';padding-bottom:8px;">',
          sTitle,  // Already encoded (TEXT)
          '</h2>'
        );
      }

      aParts.push(sBody);  // Already sanitized (HTML)

      aParts.push(
        '<div style="margin-top:24px;padding-top:12px;border-top:1px solid ' + COLORS.BORDER + ';font-size:12px;color:' + COLORS.SECONDARY + ';">',
        sFooter,  // Already encoded (TEXT)
        '</div>'
      );
      aParts.push('</div>');

      return aParts.join("");
    }
  };

  return {
    compose: EmailComposer.compose,

    // Module singleton, not instance-scoped — Component#destroy must clear
    // this or the cached bundle survives across component lifecycles.
    reset() { oBundle = null; }
  };
});
