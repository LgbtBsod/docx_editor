sap.ui.define([], function () {
    "use strict";

    /**
     * Security utilities following SAP Security Guidelines
     * Provides XSS protection, HTML sanitization, and input validation
     * @namespace com.sap.mm.massmail.utils.SecurityUtils
     */
    return {
        /**
         * Sanitizes HTML content to prevent XSS attacks
         * @param {string} sHtml - Raw HTML string
         * @returns {string} Sanitized HTML
         */
        sanitizeHtml: function (sHtml) {
            if (!sHtml || typeof sHtml !== "string") {
                return "";
            }

            // Create a temporary DOM element
            var oTemp = document.createElement("div");
            oTemp.innerHTML = sHtml;

            // Remove dangerous tags
            var aDangerousTags = ["script", "iframe", "object", "embed", "form", "input", "textarea"];
            aDangerousTags.forEach(function (sTag) {
                var aElements = oTemp.getElementsByTagName(sTag);
                while (aElements.length > 0) {
                    aElements[0].parentNode.removeChild(aElements[0]);
                }
            });

            // Remove dangerous attributes from all elements
            var aAllElements = oTemp.getElementsByTagName("*");
            var aDangerousAttrs = ["onclick", "onerror", "onload", "onmouseover", "onfocus", "onblur", "srcdoc"];
            
            for (var i = 0; i < aAllElements.length; i++) {
                var oElem = aAllElements[i];
                aDangerousAttrs.forEach(function (sAttr) {
                    if (oElem.hasAttribute(sAttr)) {
                        oElem.removeAttribute(sAttr);
                    }
                });

                // Validate href/src attributes
                ["href", "src"].forEach(function (sAttr) {
                    if (oElem.hasAttribute(sAttr)) {
                        var sValue = oElem.getAttribute(sAttr);
                        if (sValue && sValue.toLowerCase().indexOf("javascript:") === 0) {
                            oElem.removeAttribute(sAttr);
                        }
                    }
                });
            }

            return oTemp.innerHTML;
        },

        /**
         * Validates email address format
         * @param {string} sEmail - Email to validate
         * @returns {boolean} True if valid
         */
        isValidEmail: function (sEmail) {
            if (!sEmail || typeof sEmail !== "string") {
                return false;
            }
            var oRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return oRegex.test(sEmail.trim());
        },

        /**
         * Validates URL against allowed hosts
         * @param {string} sUrl - URL to validate
         * @param {string[]} aAllowedHosts - List of allowed hostnames
         * @returns {boolean} True if valid
         */
        isValidUrl: function (sUrl, aAllowedHosts) {
            if (!sUrl || typeof sUrl !== "string") {
                return false;
            }

            try {
                var oUrl = new URL(sUrl);
                
                // Only allow http/https
                if (oUrl.protocol !== "http:" && oUrl.protocol !== "https:") {
                    return false;
                }

                // Check against allowed hosts if provided
                if (aAllowedHosts && aAllowedHosts.length > 0) {
                    var sHost = oUrl.hostname.toLowerCase();
                    return aAllowedHosts.some(function (sAllowed) {
                        return sHost === sAllowed || sHost.endsWith("." + sAllowed);
                    });
                }

                return true;
            } catch (e) {
                return false;
            }
        },

        /**
         * Escapes HTML special characters
         * @param {string} sText - Text to escape
         * @returns {string} Escaped text
         */
        escapeHtml: function (sText) {
            if (!sText || typeof sText !== "string") {
                return "";
            }
            var oMap = {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                "\"": "&quot;",
                "'": "&#039;"
            };
            return sText.replace(/[&<>"']/g, function (sChar) {
                return oMap[sChar];
            });
        },

        /**
         * Validates file type based on MIME type
         * @param {string} sMimeType - MIME type to validate
         * @param {string[]} aAllowedMimes - List of allowed MIME types
         * @returns {boolean} True if valid
         */
        isValidFileType: function (sMimeType, aAllowedMimes) {
            if (!sMimeType || !aAllowedMimes || aAllowedMimes.length === 0) {
                return false;
            }
            return aAllowedMimes.indexOf(sMimeType.toLowerCase()) !== -1;
        },

        /**
         * Generates a unique idempotency key for request deduplication
         * @returns {string} UUID v4 format key
         */
        generateIdempotencyKey: function () {
            return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
                var r = Math.random() * 16 | 0;
                var v = c === "x" ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
    };
});
