/**
 * Email template composer.
 * FIXED: Clear separation of text encoding (HTML.encode) and HTML sanitization (Sanitize.forEmail).
 * FIXED: i18n moved to caller (App.controller), not hardcoded.
 */
sap.ui.define([
  "sap/ui/core/HTML",
  "emailbuilder/util/sanitize",
  "sap/base/Log"
], (HTML, Sanitize, Log) => {
  "use strict";

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
      Log.warning("[emailbuilder] Failed to load i18n bundle");
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

  /**
   * Composes the final HTML email body.
   *
   * Text fields (sTitle, sFooter) are encoded via HTML.encode() to escape special characters.
   * HTML content (sBody) is sanitized via Sanitize.forEmail() to allow tags but prevent XSS.
   *
   * @param {string} sEditorHtml raw editor HTML
   * @param {string[]} aAllowedHosts optional host whitelist forwarded to Sanitize
   * @param {string} sSubject email subject (will be text-encoded)
   * @param {sap.ui.core.UIComponent} [oComponent] for i18n
   * @returns {string} composed HTML body
   */
  const EmailComposer = {
    compose(sEditorHtml, aAllowedHosts, sSubject, oComponent) {
      // Sanitize only the HTML content
      const sBody = Sanitize.forEmail(sEditorHtml || "", aAllowedHosts);

      // Text fields are encoded as TEXT (not HTML) — safe against XSS
      // HTML.encode escapes <, >, &, etc. so they render as literal text
      const sTitle = sSubject
        ? HTML.encode(sSubject)
        : "";

      const sFooterText = getText(
        "EMAIL_FOOTER",
        "This message was sent by the mailing system.",
        oComponent
      );
      const sFooter = HTML.encode(sFooterText);

      const aParts = [
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1d2d3e;max-width:680px;margin:0 auto;">'
      ];

      if (sTitle) {
        aParts.push(
          '<h2 style="margin:0 0 16px;color:#1d2d3e;border-bottom:2px solid #0070f2;padding-bottom:8px;">',
          sTitle,  // Already encoded (TEXT)
          '</h2>'
        );
      }

      aParts.push(sBody);  // Already sanitized (HTML)

      aParts.push(
        '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #d9dde3;font-size:12px;color:#5b738b;">',
        sFooter,  // Already encoded (TEXT)
        '</div>'
      );
      aParts.push('</div>');

      return aParts.join("");
    }
  };

  return EmailComposer;
});
