sap.ui.define([
  "sap/base/Log"
], (Log) => {
  "use strict";

  /**
   * Local-only persistence for mock-mode sends (posts to the dev server.js
   * endpoint, which drops a JSON file per mailing under saved_emails/).
   *
   * This is the ONLY place in the app that knows window.USE_MOCK exists.
   * Every export below no-ops (resolves immediately, no XHR, no reference
   * to window.USE_MOCK leaking into caller code) when it's off — flipping
   * USE_MOCK to false is the entire "go to production" switch: nothing
   * else in the send path branches on it.
   */

  function isActive() {
    return !!window.USE_MOCK;
  }

  function postToLocalServer(oPayload) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/save-email", true);
      xhr.setRequestHeader("Content-Type", "application/json");

      xhr.onload = () => {
        if (xhr.status === 200) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            reject(new Error("Invalid server response"));
          }
        } else {
          reject(new Error("Server error: " + xhr.status));
        }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(JSON.stringify(oPayload));
    });
  }

  /**
   * Records a completed send to the local saved_emails/ folder for manual
   * inspection during development. No-op when not in mock mode.
   *
   * @param {object} oPayload the composed mailing payload (LocalId, Subject,
   *   Content, ToRecipients, Attachments) as sent to the OData service
   * @param {object[]} aRecipients full recipient list — test sends omit
   *   ToRecipients on the wire (the backend targets the test send at the
   *   calling user), so the mock record restores the real list from local
   *   state purely so it can show what a test send would have looked like
   * @param {boolean} bIsTest whether this was a test send
   * @returns {Promise<void>} resolves once the local save attempt settles;
   *   never rejects — a failed local save must not block the "sent"
   *   confirmation the user already saw
   */
  function recordSend(oPayload, aRecipients, bIsTest) {
    if (!isActive()) { return Promise.resolve(); }

    const oMockRecord = Object.assign({}, oPayload, {
      ToRecipients: aRecipients,
      IsTest: bIsTest
    });

    return postToLocalServer(oMockRecord).then(
      () => undefined,
      (e) => { Log.warning("[emailbuilder] Mock email save failed: " + e.message); }
    );
  }

  return {
    isActive: isActive,
    recordSend: recordSend
  };
});
