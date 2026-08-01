sap.ui.define([
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/base/Log",
  "MAILING_CONSTRUCTOR/util/config",
  "MAILING_CONSTRUCTOR/util/constants"
], (Filter, FilterOperator, Log, Config, Constants) => {
  "use strict";

  const DEFAULT_RETRY_WAIT_MS = 1000;
  const MAX_RETRIES = 3;

  /**
   * A 4xx response (bad filter, missing entity, auth) is deterministic —
   * retrying sends the exact same invalid request three more times and
   * only delays the error reaching the user. Only a missing status (network
   * failure before any response) or a 5xx (transient server-side issue) is
   * worth a backoff retry.
   *
   * @param {object} oError ODataModel v2 read() error object
   * @returns {boolean} true if this failure is worth retrying
   * @private
   */
  function isRetryable(oError) {
    const vStatus = oError && (
      (oError.response && oError.response.statusCode) || oError.statusCode
    );
    if (vStatus === undefined || vStatus === null || vStatus === "") { return true; }
    return parseInt(vStatus, 10) >= 500;
  }

  function extractResults(oData) {
    if (!oData) { return []; }
    if (Array.isArray(oData)) { return oData; }
    if (Array.isArray(oData.results)) { return oData.results; }
    if (oData.d && Array.isArray(oData.d.results)) { return oData.d.results; }
    if (oData.d) { return [oData.d]; }
    return [oData];
  }

  function extractEntity(oData) {
    if (!oData) { return {}; }
    return oData.d || oData;
  }

  function getModel(oComponent) {
    return oComponent ? oComponent.getModel() : null;
  }

  /**
   * Builds a canonical entity path via ODataModel#createKey — the standard
   * API handles OData key escaping (quotes etc.), no manual concatenation.
   *
   * @param {sap.ui.core.UIComponent} oComponent owner component
   * @param {string} sSet entity set name
   * @param {object} oKeys key property map
   * @returns {Promise<string>} resolves with the canonical path
   * @private
   */
  function entityPath(oComponent, sSet, oKeys) {
    const oModel = getModel(oComponent);
    if (!oModel) { return Promise.reject(new Error("OData model not available")); }
    return oModel.metadataLoaded().then(() => "/" + oModel.createKey(sSet, oKeys));
  }

  /**
   * OData read with exponential backoff retry.
   *
   * Improves resilience to transient network failures (only 5xx and
   * connection drops are retried — see isRetryable).
   *
   * @param {sap.ui.core.UIComponent} oComponent owner component
   * @param {string} sPath entity path or entity set
   * @param {sap.ui.model.Filter[]} [aFilters] filter array
   * @param {number} [iTop] $top page size; 0 means "no $top"
   * @param {object} [mExtraUrlParams] extra $-prefixed URL parameters
   *   (e.g. { "$search": "vendor" }) merged on top of $top; used by
   *   callers needing $search (unused in 1.71 binding path)
   * @returns {Promise<object>} resolves with the raw OData response
   */
  function readWithRetry(oComponent, sPath, aFilters, iTop, mExtraUrlParams) {
    /**
     * @param {number} iRetry current retry attempt (0-based, internal)
     * @private
     */
    return function _attempt(iRetry) {
      iRetry = iRetry || 0;
      return new Promise((resolve, reject) => {
        const oModel = getModel(oComponent);
        if (!oModel) {
          reject(new Error("OData model not available"));
          return;
        }

        const mParams = {
          success: (oData) => resolve(oData),
          error: (oError) => {
            if (iRetry < MAX_RETRIES && isRetryable(oError)) {
              setTimeout(() => {
                _attempt(iRetry + 1).then(resolve, reject);
              }, DEFAULT_RETRY_WAIT_MS * (iRetry + 1));
            } else {
              reject(parseError(oError));
            }
          }
        };

        if (aFilters && aFilters.length > 0) {
          mParams.filters = aFilters;
        }
        if (iTop !== 0) {
          const iEffectiveTop = iTop || Constants.PERFORMANCE.DEFAULT_TOP;
          mParams.urlParameters = Object.assign({
            "$top": String(Math.min(iEffectiveTop, Constants.PERFORMANCE.MAX_COLLECTION_SIZE))
          }, mExtraUrlParams || {});
        } else if (mExtraUrlParams) {
          mParams.urlParameters = Object.assign({}, mExtraUrlParams);
        }

        try {
          oModel.read(sPath, mParams);
        } catch (e) {
          reject(e);
        }
      });
    }(0);
  }

  function create(oComponent, sPath, oData) {
    return new Promise((resolve, reject) => {
      const oModel = getModel(oComponent);
      if (!oModel) {
        reject(new Error("OData model not available"));
        return;
      }
      try {
        oModel.create(sPath, oData, {
          success: (oCreated) => resolve(oCreated),
          error: (oError) => reject(parseError(oError))
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Normalises an OData v2 error payload into a JS Error.
   *
   * Gateway can answer an error in two wire formats depending on the
   * Accept header / error contract negotiated by sap.ui.model.odata.v2:
   *   - JSON:  {"error":{"code":"...","message":{"value":"..."}}}
   *   - XML:   <error xmlns="..."><message>...</message></error>
   * Both branches are surfaced as Error messages; the XML branch is parsed
   * explicitly instead of letting JSON.parse throw and mask the real cause.
   *
   * @param {object} oError OData error object
   * @returns {Error} normalised error with the backend's message, if any
   * @private
   */
  function parseError(oError) {
    let sMsg = "Request failed";
    if (!oError) { return new Error(sMsg); }
    try {
      if (oError.responseText) {
        const sTrimmed = oError.responseText.trim();
        // JSON branch: leading "{" or "[" (some gateways wrap error arrays)
        if (sTrimmed.charAt(0) === "{" || sTrimmed.charAt(0) === "[") {
          const oParsed = JSON.parse(oError.responseText);
          if (oParsed && oParsed.error && oParsed.error.message
            && oParsed.error.message.value) {
            sMsg = oParsed.error.message.value;
          }
        } else if (oError.responseText.indexOf("<error") >= 0
          || oError.responseText.indexOf("<?xml") === 0) {
          // XML branch: <error><message>text</message></error>
          // (DOMParser is the standard, non-regex way to walk XML in 1.71.)
          const oDoc = new DOMParser().parseFromString(oError.responseText, "application/xml");
          const oMsg = oDoc.querySelector("message");
          if (oMsg && oMsg.textContent) {
            sMsg = oMsg.textContent;
          }
        }
      }
      if (sMsg === "Request failed" && oError.message) { sMsg = oError.message; }
    } catch (e) {
      if (oError.message) { sMsg = oError.message; }
    }
    return new Error(sMsg);
  }

  /**
   * Sends a mailing (deep create on MailHeaderSet).
   *
   * @param {sap.ui.core.UIComponent} oComponent owner component
   * @param {object} oPayload { LocalId, Subject, Content, ToRecipients, Attachments }
   * @param {boolean} bIsTest whether this is a test send
   * @returns {Promise<{localId:string, messageKey:string}>} send result;
   *   messageKey is a plain i18n key resolved by the caller
   */
  function sendMailing(oComponent, oPayload, bIsTest) {
    const oDeepEntity = {
      LocalId: oPayload.LocalId,
      Subject: oPayload.Subject,
      ToRecipients: (oPayload.ToRecipients || []).map((r) => ({
        RecipientId: r.id || r.RecipientId || "",
        Email:       r.email || r.Email || "",
        FullName:    r.name || r.FullName || "",
        Role:        r.role || r.Role || ""
      })),
      ToTexts: oPayload.Content ? [{ Content: oPayload.Content }] : [],
      ToAttachments: (oPayload.Attachments || []).map((a) => ({
        FileName:      a.name || a.FileName || "",
        MimeType:      a.mimeType || a.MimeType || "application/octet-stream",
        ContentBase64: a.base64 || a.ContentBase64 || ""
      }))
    };

    return create(oComponent, "/" + Constants.ODATA.ENTITY_SETS.MAIL_HEADER, oDeepEntity).then((oData) => {
      const oEntity = extractEntity(oData);
      return {
        localId: oEntity.LocalId || oPayload.LocalId,
        messageKey: bIsTest ? "MSG_TEST_SENT" : "MSG_SENT"
      };
    });
  }

  /**
   * Returns the status breakdown for a mailing (unified display domain,
   * mapped in CDS ZI_Mailing_Status).
   *
   * @param {sap.ui.core.UIComponent} oComponent owner component
   * @param {string} sMailingId mailing id
   * @returns {Promise<Array>} status list
   */
  function getMailingStatus(oComponent, sMailingId) {
    const aFilters = sMailingId
      ? [new Filter("MailingId", FilterOperator.EQ, sMailingId)]
      : [];
    return readWithRetry(oComponent, "/" + Constants.ODATA.ENTITY_SETS.MAILING_STATUS, aFilters, Constants.PERFORMANCE.DEFAULT_TOP)
      .then(extractResults);
  }

  /**
   * Reads the full HTML body of a single mailing (key access on the
   * LOB-carrying MailContentSet — never part of list reads).
   *
   * @param {sap.ui.core.UIComponent} oComponent owner component
   * @param {string} sId mailing key
   * @returns {Promise<object>} { Key, LocalID, Subject, Content }
   */
  function getMailingContent(oComponent, sId) {
    return entityPath(oComponent, Constants.ODATA.ENTITY_SETS.MAIL_CONTENT, { Key: sId })
      .then((sPath) => readWithRetry(oComponent, sPath, null, 0))
      .then(extractEntity);
  }

  /**
   * Copies a mailing into a new draft: reads subject + content by key and
   * resolves with a fresh LocalId.
   *
   * @param {sap.ui.core.UIComponent} oComponent owner component
   * @param {string} sId source mailing id
   * @returns {Promise<{LocalId:string, Subject:string, Content:string}>} copy result
   */
  function copyMailing(oComponent, sId) {
    return getMailingContent(oComponent, sId)
      .then((oEntry) => ({
        LocalId: Config.generateLocalId(),
        Subject: oEntry.Subject || "",
        Content: oEntry.Content || ""
      }))
      .catch((err) => {
        const sMsg = `Unable to load mailing ${sId}`;
        Log.error("[MAILING_CONSTRUCTOR] " + sMsg);
        return Promise.reject(new Error(sMsg));
      });
  }

  /**
   * Reads the single-row runtime config entity (MaxRecipients, SubjectMaxLen,
   * ChunkSize) served by the backend from ZCL_NEWSLETTER_CONSTANTS
   * (zcl_eb_mailing_dpc_ext#build_mailing_config). This is the single source
   * of truth for those limits — util/constants.js only holds fallback
   * defaults for the brief window before this resolves (or if it fails).
   *
   * @param {sap.ui.core.UIComponent} oComponent owner component
   * @returns {Promise<{MaxRecipients:number, SubjectMaxLen:number, ChunkSize:number}>}
   */
  function getMailingConfig(oComponent) {
    return entityPath(oComponent, Constants.ODATA.ENTITY_SETS.MAILING_CONFIG, { Key: "1" })
      .then((sPath) => readWithRetry(oComponent, sPath, null, 0))
      .then(extractEntity);
  }

  /**
   * Reads the full mailing history (MailHistorySet list).
   *
   * @param {sap.ui.core.UIComponent} oComponent owner component
   * @returns {Promise<Array>} mailing history entries
   */
  function getMailHistory(oComponent) {
    return readWithRetry(oComponent, "/" + Constants.ODATA.ENTITY_SETS.MAIL_HISTORY, null, Constants.PERFORMANCE.DEFAULT_TOP)
      .then(extractResults);
  }

  /**
   * Loads the service dictionary — all lookup tables (statuses, news types,
   * allowed hosts) in one round-trip. Frontend stores the result in a
   * JSONModel "dict" and formatter.js / SFB value-help read from it.
   *
   * @param {sap.ui.core.UIComponent} oComponent owner component
   * @returns {Promise<Array>} all dictionary entries
   */
  function getServiceDict(oComponent) {
    return readWithRetry(oComponent, "/" + Constants.ODATA.ENTITY_SETS.SERVICE_DICT, null, 0)
      .then(extractResults);
  }

  return {
    sendMailing: sendMailing,
    getMailHistory: getMailHistory,
    getMailingStatus: getMailingStatus,
    getMailingContent: getMailingContent,
    copyMailing: copyMailing,
    getMailingConfig: getMailingConfig,
    getServiceDict: getServiceDict
  };
});
