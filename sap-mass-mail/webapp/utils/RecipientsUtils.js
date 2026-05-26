sap.ui.define([], function () {
    "use strict";

    function normalizeEmail(sEmail) {
        return (sEmail || "").trim().toLowerCase();
    }

    return {
        addRecipientsByList: function (aCurrentRecipients, aNewRecipients, fnIsValidEmail) {
            var aRecipients = (aCurrentRecipients || []).slice();
            var oExisting = {};

            aRecipients.forEach(function (oRecipient) {
                if (oRecipient.email) {
                    oExisting[normalizeEmail(oRecipient.email)] = true;
                }
            });

            var iAdded = 0;
            (aNewRecipients || []).forEach(function (oNewRecipient) {
                var sEmail = normalizeEmail(oNewRecipient.email);
                if (sEmail && fnIsValidEmail(sEmail) && !oExisting[sEmail]) {
                    aRecipients.push({
                        email: sEmail,
                        fullName: oNewRecipient.name || "",
                        role: oNewRecipient.department || ""
                    });
                    oExisting[sEmail] = true;
                    iAdded++;
                }
            });

            return { recipients: aRecipients, added: iAdded };
        },

        addRecipientsByEmails: function (aCurrentRecipients, aEmails, fnIsValidEmail) {
            var aRecipients = (aCurrentRecipients || []).slice();
            var oExisting = {};
            aRecipients.forEach(function (oRecipient) {
                if (oRecipient.email) {
                    oExisting[normalizeEmail(oRecipient.email)] = true;
                }
            });

            var iAdded = 0;
            (aEmails || []).forEach(function (sEmail) {
                var sNormalized = normalizeEmail(sEmail);
                if (fnIsValidEmail(sNormalized) && !oExisting[sNormalized]) {
                    aRecipients.push({ email: sNormalized, fullName: "", role: "" });
                    oExisting[sNormalized] = true;
                    iAdded++;
                }
            });

            return { recipients: aRecipients, added: iAdded };
        }
    };
});
