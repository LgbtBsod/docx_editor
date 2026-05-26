sap.ui.define([], function () {
    "use strict";

    return {
        isAttachmentAllowed: function (oFile, aCurrentAttachments, oLimits, fnIsAllowedMime) {
            var aAttachments = aCurrentAttachments || [];
            var iCurrentSize = aAttachments.reduce(function (sum, oItem) { return sum + (oItem.fileSize || 0); }, 0);

            if (oFile.size > oLimits.maxFileSize) {
                return { ok: false, reason: "maxFileSize", value: oFile.name };
            }

            if (iCurrentSize + oFile.size > oLimits.maxTotalSize) {
                return { ok: false, reason: "maxTotalSize" };
            }

            if (oFile.type && !fnIsAllowedMime(oFile.type)) {
                return { ok: false, reason: "invalidMime", value: oFile.name };
            }

            return { ok: true };
        }
    };
});
