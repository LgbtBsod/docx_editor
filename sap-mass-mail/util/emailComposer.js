sap.ui.define([
  "sap/base/security/encodeXML",
  "emailbuilder/util/sanitize",
  "sap/base/Log",
  "sap/base/i18n/ResourceBundle"
], (encodeXML, Sanitize, Log, ResourceBundle) => {
  "use strict";

  /**
   * Lazily-loaded i18n resource bundle for composer strings.
   * Falls back to a hardcoded Russian default when the bundle is unavailable.
   */
  let oBundle = null;
  let bBundleLoaded = false;

  function getBundle() {
    if (bBundleLoaded) { return oBundle; }
    bBundleLoaded = true;
    try {
      const oConfig = sap.ui.getCore().getConfiguration();
      const sUrl = sap.ui.require.toUrl("emailbuilder/i18n/i18n.properties");
      oBundle = ResourceBundle.create({
        url: sUrl,
        locale: oConfig.getLanguageTag()
      });
    } catch (e) {
      Log.warning("[emailbuilder] EmailComposer: i18n bundle load failed: " + e.message);
      oBundle = null;
    }
    return oBundle;
  }

  function getText(sKey, sFallback) {
    const oB = getBundle();
    if (oB) {
      try {
        const sText = oB.getText(sKey);
        if (sText && sText !== sKey) { return sText; }
      } catch (e) { /* fall through */ }
    }
    return sFallback;
  }

  /**
   * Email template wrapper. Sanitizes the editor HTML via DOMPurify and
   * wraps it in a responsive email-compatible container.
   */
  const EmailComposer = {

    /**
     * Composes the final HTML email body.
     *
     * @param {string} sEditorHtml raw editor HTML
     * @param {string[]} aAllowedHosts optional host whitelist forwarded to Sanitize
     * @param {string} sSubject email subject (rendered as H2 title)
     * @returns {string} composed HTML body
     */
    compose(sEditorHtml, aAllowedHosts, sSubject) {
      const sBody = Sanitize.forEmail(sEditorHtml || "", aAllowedHosts);
      const sTitle = sSubject ? encodeXML(sSubject) : "";
      const sFooter = encodeXML(getText("EMAIL_FOOTER", "Это сообщение отправлено системой рассылок."));

      const aParts = [
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1d2d3e;max-width:680px;margin:0 auto;">'
      ];
      if (sTitle) {
        aParts.push(
          '<h2 style="margin:0 0 16px;color:#1d2d3e;border-bottom:2px solid #0070f2;padding-bottom:8px;">',
          sTitle,
          '</h2>'
        );
      }
      aParts.push(sBody);
      aParts.push(
        '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #d9dde3;font-size:12px;color:#5b738b;">',
        sFooter,
        '</div>'
      );
      aParts.push('</div>');
      return aParts.join("");
    }
  };

  return EmailComposer;
});
