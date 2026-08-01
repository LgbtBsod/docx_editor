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
    return sModulePath.replace(/^MAILING_CONSTRUCTOR\//, "");
  }

  /**
   * Extracts the deep MailHeader payload object from a raw request body.
   * Works for both a plain JSON create body and a $batch changeset body
   * (the app runs with useBatch:true), by scanning for the JSON fragment
   * that carries LocalId. Returns {} when none is found.
   *
   * Uses a string-aware scanner so braces inside JSON string values
   * (HTML/CSS content) don't break the depth counter.
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

    // Batch body: find the JSON object containing "LocalId" using a
    // string-aware scanner so braces inside JSON string values (HTML/CSS
    // content) don't break the depth counter.
    const iIdx = sBody.indexOf('"LocalId"');
    if (iIdx < 0) { return {}; }
    // Walk back to the opening brace of the object holding LocalId.
    let iStart = iIdx;
    while (iStart > 0 && sBody[iStart] !== "{") { iStart--; }
    if (sBody[iStart] !== "{") { return {}; }
    // Walk forward with a string-aware brace counter.
    let iDepth = 0;
    let iEnd = -1;
    let bInString = false;
    let bEscape = false;
    for (let j = iStart; j < sBody.length; j++) {
      const c = sBody[j];
      if (bEscape) { bEscape = false; continue; }
      if (c === "\\") { bEscape = true; continue; }
      if (c === '"') { bInString = !bInString; continue; }
      if (bInString) { continue; }
      if (c === "{") { iDepth++; }
      else if (c === "}") {
        iDepth--;
        if (iDepth === 0) { iEnd = j; break; }
      }
    }
    if (iEnd < 0) { return {}; }
    try { return JSON.parse(sBody.slice(iStart, iEnd + 1)); }
    catch (e2) { return {}; }
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
        // New mailing enters the queue (root CHAR(3) "001") on create —
        // matches ZCL_NEWSLETTER_CONSTANTS=>root_status-QUEUE that
        // zcl_eb_mailing_mod_builder=>build_deep sets on the header.
        // The dispatcher walks it through 010 -> 100/900 asynchronously.
        Status: "001", CreatedAt: sOdataDate, CreatedBy: "PREVIEW",
        TotalCount: aRecipients.length, SentCount: 0, ErrorCount: 0
      });
      _oMockServer.setEntitySetData("MailHistorySet", aHistory);

      const aContent = _oMockServer.getEntitySetData("MailContentSet") || [];
      aContent.unshift({ Key: sKey, LocalID: sLocalId, Subject: sSubject, Content: sContent });
      _oMockServer.setEntitySetData("MailContentSet", aContent);
    } catch (e) {
      Log.error("[MAILING_CONSTRUCTOR] MockServer read-model sync failed: " + e.message);
    }
  }

  /**
   * Builds RecipientUserSet mock data by grouping RecipientSet rows by email.
   * Each unique email gets one row with comma-joined Roles and an AuthCount.
   * Mirrors the ABAP CDS: GROUP BY bname, email, full_name.
   * @private
   */
  function buildGroupedRecipients() {
    try {
      const aDetailed = _oMockServer.getEntitySetData("RecipientSet") || [];
      const mGroups = {};
      let i, r, key, g;
      for (i = 0; i < aDetailed.length; i++) {
        r = aDetailed[i];
        key = (r.Email || "").toLowerCase();
        if (!mGroups[key]) {
          mGroups[key] = { Email: r.Email, FullName: r.FullName, roles: {}, authCount: 0 };
        }
        g = mGroups[key];
        if (r.Role) { g.roles[r.Role] = true; }
        g.authCount++;
      }
      const aGrouped = [];
      const aKeys = Object.keys(mGroups);
      const sRootUri = getRootUri();
      for (i = 0; i < aKeys.length; i++) {
        g = mGroups[aKeys[i]];
        const sEmail = g.Email || "";
        const sEncodedKey = encodeURIComponent(sEmail);
        const sUri = sRootUri + "RecipientUserSet('" + sEncodedKey + "')";
        aGrouped.push({
          Email: sEmail,
          FullName: g.FullName,
          Roles: Object.keys(g.roles).join(", "),
          AuthCount: g.authCount,
          __metadata: {
            id: sUri,
            type: "eb.RecipientUser",
            uri: sUri
          }
        });
      }
      _oMockServer.setEntitySetData("RecipientUserSet", aGrouped);
      Log.info("[MAILING_CONSTRUCTOR] RecipientUserSet built: " + aGrouped.length +
        " grouped users from " + aDetailed.length + " detail rows");
    } catch (e) {
      Log.error("[MAILING_CONSTRUCTOR] Failed to build grouped recipients: " + e.message);
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

      _oMockServer.simulate(resolveUrl("MAILING_CONSTRUCTOR/localService/metadata.xml"), {
        sMockdataBaseUrl: resolveUrl("MAILING_CONSTRUCTOR/localService/mockdata/"),
        bGenerateMissingMockData: true
      });

      // Generate RecipientUserSet (GROUP BY email) from RecipientSet.
      // On the ABAP side this is a separate CDS with GROUP BY uname/email.
      buildGroupedRecipients();

      // Sync read models after every MailHeaderSet create (direct or batched).
      _oMockServer.attachAfter(MockServer.HTTPMETHOD.POST, syncReadModelsAfterCreate, "MailHeaderSet");

      _oMockServer.start();
      Log.info("[MAILING_CONSTRUCTOR] MockServer started on " + sRootUri);
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
