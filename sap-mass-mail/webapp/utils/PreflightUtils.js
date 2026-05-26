sap.ui.define([], function () {
    "use strict";

    return {
        countUnsafeLinks: function (aLinks, fnIsAllowedHost) {
            return (aLinks || []).filter(function (oLink) {
                if (!oLink.url || !/^https:\/\//i.test(oLink.url)) {
                    return true;
                }
                try {
                    var oUrl = new URL(oLink.url);
                    return !fnIsAllowedHost(oUrl.hostname);
                } catch (e) {
                    return true;
                }
            }).length;
        },

        checkHtmlIssues: function (sHtml) {
            var iIssues = 0;
            if (!sHtml) {
                return 0;
            }
            var aOpenTags = sHtml.match(/<([a-z]+)(?:\s[^>]*)?(?<!\/)>/gi) || [];
            var aCloseTags = sHtml.match(/<\/([a-z]+)\s*>/gi) || [];
            if (aOpenTags.length !== aCloseTags.length) {
                iIssues++;
            }
            if (/<script/i.test(sHtml)) {
                iIssues++;
            }
            if (/on(click|load|error|mouseover)/i.test(sHtml)) {
                iIssues++;
            }
            return iIssues;
        }
    };
});
