sap.ui.define([
  "sap/ui/core/util/MockServer",
  "sap/base/Log"
], (MockServer, Log) => {
  "use strict";

  let _oMockServer = null;

  function getRootUri() {
    return (window.SAP_GATEWAY_URI) || "/sap/opu/odata/sap/ZEB_MAILING_SRV/";
  }

  function resolveUrl(sModulePath) {
    try {
      if (typeof sap.ui.require.toUrl === "function") {
        return sap.ui.require.toUrl(sModulePath);
      }
    } catch (e) { /* fall through */ }
    return sModulePath.replace(/^emailbuilder\//, "");
  }

  /**
   * Extracts the deep MailHeader payload object from a raw request body.
   * Works for both a plain JSON create body and a $batch changeset body
   * (the app runs with useBatch:true), by scanning for the JSON fragment
   * that carries LocalId. Returns {} when none is found.
   *
   * @param {string} sBody raw request body (JSON or multipart batch)
   * @returns {object} parsed payload (unwrapped from any `d` envelope)
   * @private
   */
  function extractDeepPayload(sBody) {
    if (!sBody) { return {}; }
    // Fast path: whole body is the entity JSON.
    try {
      const oWhole = JSON.parse(sBody);
      return oWhole.d || oWhole;
    } catch (e) { /* batch body — scan for the embedded JSON object */ }

    const iStart = sBody.indexOf("{");
    while (true) {
      const i = sBody.indexOf('"LocalId"', iStart);
      if (i < 0) { break; }
      // Walk back to the opening brace of the object holding LocalId.
      let iOpen = sBody.lastIndexOf("{", i);
      // Balance braces forward to find the matching close.
      let iDepth = 0;
      for (let j = iOpen; j < sBody.length; j++) {
        if (sBody[j] === "{") { iDepth++; }
        else if (sBody[j] === "}") {
          iDepth--;
          if (iDepth === 0) {
            try { return JSON.parse(sBody.slice(iOpen, j + 1)); }
            catch (e2) { return {}; }
          }
        }
      }
      break;
    }
    return {};
  }

  /**
   * Syncs MailHistorySet (list) and MailContentSet (LOB) after a MailHeaderSet
   * create. Registered via attachAfter so it fires for BOTH direct and batched
   * POSTs — the app runs with useBatch:true, where a top-level custom route is
   * bypassed by the $batch handler. The generated route creates the header and
   * echoes the client LocalId; this only mirrors it into the read models.
   *
   * @param {sap.ui.base.Event} oEvent MockServer after-POST event
   * @private
   */
  function syncReadModelsAfterCreate(oEvent) {
    try {
      const oEntity = oEvent.getParameter("oEntity") || {};
      const oXhr = oEvent.getParameter("oXhr");
      const oPayload = extractDeepPayload(oXhr && oXhr.requestBody);

      const sKey = oEntity.Key || ("m" + Date.now());
      const sLocalId = oEntity.LocalId || oPayload.LocalId || ("MSG-" + Date.now());
      const sSubject = oEntity.Subject || oPayload.Subject || "";
      const aRecipients = oPayload.ToRecipients || [];
      const aTexts = oPayload.ToTexts || [];
      const sContent = (aTexts.length > 0 ? (aTexts[0].Content || "") : "");
      const sOdataDate = "/Date(" + Date.now() + ")/";

      const aHistory = _oMockServer.getEntitySetData("MailHistorySet") || [];
      aHistory.unshift({
        Key: sKey, LocalID: sLocalId, Subject: sSubject,
        Status: "020", CreatedAt: sOdataDate, CreatedBy: "PREVIEW",
        TotalCount: aRecipients.length, SentCount: 0, ErrorCount: 0
      });
      _oMockServer.setEntitySetData("MailHistorySet", aHistory);

      const aContent = _oMockServer.getEntitySetData("MailContentSet") || [];
      aContent.unshift({ Key: sKey, LocalID: sLocalId, Subject: sSubject, Content: sContent });
      _oMockServer.setEntitySetData("MailContentSet", aContent);
    } catch (e) {
      Log.error("[emailbuilder] MockServer read-model sync failed: " + e.message);
    }
  }

  return {

    init() {
      const sRootUri = getRootUri();
      _oMockServer = new MockServer({ rootUri: sRootUri });

      MockServer.config({
        autoRespond: true,
        autoRespondAfter: 0
      });

      _oMockServer.simulate(resolveUrl("emailbuilder/localService/metadata.xml"), {
        sMockdataBaseUrl: resolveUrl("emailbuilder/localService/mockdata/"),
        bGenerateMissingMockData: true
      });

      // Sync read models after every MailHeaderSet create (direct or batched).
      _oMockServer.attachAfter(MockServer.HTTPMETHOD.POST, syncReadModelsAfterCreate, "MailHeaderSet");

      _oMockServer.start();
      Log.info("[emailbuilder] MockServer started on " + sRootUri);
    },

    setComponent(oComponent) {
      if (oComponent && typeof oComponent.setMockServer === "function") {
        oComponent.setMockServer(_oMockServer);
      }
    },

    getMockServer() {
      return _oMockServer;
    },

    stop() {
      if (_oMockServer) {
        _oMockServer.stop();
        _oMockServer.destroy();
        _oMockServer = null;
      }
    }
  };
});
