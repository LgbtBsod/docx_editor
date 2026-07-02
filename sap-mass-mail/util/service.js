sap.ui.define([
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/base/Log",
  "emailbuilder/util/config"
], (Filter, FilterOperator, Log, Config) => {
  "use strict";

  /**
   * Server-side page size cap applied to every collection read.
   */
  const DEFAULT_TOP = 100;
  const MAX_COLLECTION_SIZE = 5000;

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

  function read(oComponent, sPath, aFilters, iTop) {
    return new Promise((resolve, reject) => {
      const oModel = getModel(oComponent);
      if (!oModel) {
        reject(new Error("OData model not available"));
        return;
      }
      const mParams = {
        success: (oData) => resolve(oData),
        error: (oError) => reject(parseError(oError))
      };
      if (aFilters && aFilters.length > 0) {
        mParams.filters = aFilters;
      }
      if (iTop !== 0) {
        const iEffectiveTop = iTop || DEFAULT_TOP;
        mParams.urlParameters = { "$top": String(Math.min(iEffectiveTop, MAX_COLLECTION_SIZE)) };
      }
      try {
        oModel.read(sPath, mParams);
      } catch (e) {
        reject(e);
      }
    });
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
   * (The ODataUtils.parseErrorMessage branch was removed — the API does not
   * exist in 1.71, the branch was dead code.)
   *
   * @param {object} oError OData error object
   * @returns {Error} normalised error
   * @private
   */
  function parseError(oError) {
    let sMsg = "Request failed";
    try {
      if (oError && oError.responseText) {
        const oParsed = JSON.parse(oError.responseText);
        if (oParsed && oParsed.error && oParsed.error.message
          && oParsed.error.message.value) {
          sMsg = oParsed.error.message.value;
        }
      } else if (oError && oError.message) {
        sMsg = oError.message;
      }
    } catch (e) { /* keep default */ }
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
      Status: bIsTest ? "010" : "020",
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

    return create(oComponent, "/MailHeaderSet", oDeepEntity).then((oData) => {
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
    return read(oComponent, "/MailingStatusSet", aFilters, DEFAULT_TOP).then(extractResults);
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
    return entityPath(oComponent, "MailContentSet", { Key: sId })
      .then((sPath) => read(oComponent, sPath, null, 0))
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
        const sMsg = `Unable to load mailing ${sId} for copy`;
        Log.error("[emailbuilder] " + sMsg + ": " + err.message);
        return Promise.reject(new Error(sMsg));
      });
  }

  /**
   * Returns the allowed hosts list.
   *
   * @param {sap.ui.core.UIComponent} oComponent owner component
   * @returns {Promise<Array>} allowed host entries
   */
  function getAllowedHosts(oComponent) {
    return read(oComponent, "/AllowedHostSet", null, DEFAULT_TOP).then(extractResults);
  }

  return {
    sendMailing: sendMailing,
    getMailingStatus: getMailingStatus,
    getMailingContent: getMailingContent,
    copyMailing: copyMailing,
    getAllowedHosts: getAllowedHosts
  };
});
