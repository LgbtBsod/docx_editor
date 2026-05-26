sap.ui.define([], function () {
    "use strict";

    return {
        getPlainTextLength: function (sHtml) {
            return String(sHtml || "").replace(/<[^>]*>/g, "").length;
        },

        enforceMaxChars: function (sHtml, iMaxChars, fnEscapeHtml) {
            var sSanitized = String(sHtml || "");
            var sPlainText = sSanitized.replace(/<[^>]*>/g, "");
            if (sPlainText.length <= iMaxChars) {
                return { html: sSanitized, plainTextLength: sPlainText.length, truncated: false };
            }
            sPlainText = sPlainText.slice(0, iMaxChars);
            return {
                html: fnEscapeHtml(sPlainText).replace(/\n/g, "<br>"),
                plainTextLength: sPlainText.length,
                truncated: true
            };
        }
    };
});
