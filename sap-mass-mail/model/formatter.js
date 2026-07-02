sap.ui.define([
  "sap/ui/core/format/DateFormat",
  "sap/base/Log",
  "emailbuilder/util/sanitize"
], (DateFormat, Log, Sanitize) => {
  "use strict";

  let oDateTimeFormat = null;
  let oTimeFormat = null;

  /**
   * Resource bundle injected by the controller (Formatter.setResourceBundle).
   * @type {sap.base.i18n.ResourceBundle|null}
   */
  let oInjectedBundle = null;

  /**
   * Unified status dictionary (single source): the backend maps receiver
   * codes into this domain inside CDS ZI_Mailing_Status, so every consumer
   * of Status works with exactly these codes.
   */
  const STATUS_META = {
    "010": { key: "STATUS_LABEL_NEW",     fallback: "Новый",      cls: "ebStatusUnknown", state: "None",    icon: "sap-icon://hint" },
    "020": { key: "STATUS_LABEL_PENDING", fallback: "Ожидание",   cls: "ebStatusPending", state: "Warning", icon: "sap-icon://pending" },
    "030": { key: "STATUS_LABEL_PENDING", fallback: "Ожидание",   cls: "ebStatusPending", state: "Warning", icon: "sap-icon://pending" },
    "040": { key: "STATUS_LABEL_SENT",    fallback: "Отправлено", cls: "ebStatusSent",    state: "Success", icon: "sap-icon://message-success" },
    "050": { key: "STATUS_LABEL_FAILED",  fallback: "Ошибка",     cls: "ebStatusFailed",  state: "Error",   icon: "sap-icon://message-error" }
  };

  function statusMeta(sStatus) {
    return STATUS_META[String(sStatus)] || null;
  }

  /**
   * Parses an OData `\/Date(ms)\/` string, ISO-8601 string, epoch number or
   * Date instance into a Date. Returns null when unparseable.
   *
   * @param {string|number|Date} vValue value to parse
   * @returns {Date|null} parsed date or null
   * @private
   */
  function parseDate(vValue) {
    if (vValue === null || vValue === undefined || vValue === "") { return null; }
    if (vValue instanceof Date) { return isNaN(vValue.getTime()) ? null : vValue; }
    if (typeof vValue === "number") {
      return isNaN(vValue) ? null : new Date(vValue);
    }
    if (typeof vValue === "string") {
      const m = vValue.match(/\/Date\((-?\d+)(?:[+-]\d+)?\)\//);
      if (m) {
        const iMs = parseInt(m[1], 10);
        return isNaN(iMs) ? null : new Date(iMs);
      }
      const iMs = Date.parse(vValue);
      return isNaN(iMs) ? null : new Date(iMs);
    }
    return null;
  }

  function getDateTimeFormat() {
    if (!oDateTimeFormat) {
      oDateTimeFormat = DateFormat.getInstance({ pattern: "dd.MM.yyyy HH:mm" });
    }
    return oDateTimeFormat;
  }

  function getTimeFormat() {
    if (!oTimeFormat) {
      oTimeFormat = DateFormat.getInstance({ pattern: "HH:mm" });
    }
    return oTimeFormat;
  }

  function getText(sKey, aArgs, sFallback) {
    if (oInjectedBundle) {
      try {
        const sText = oInjectedBundle.getText(sKey, aArgs);
        if (sText && sText !== sKey) { return sText; }
      } catch (e) {
        Log.warning("[emailbuilder] i18n key missing: " + sKey);
      }
    }
    return sFallback !== undefined ? sFallback : sKey;
  }

  const Formatter = {

    setResourceBundle(oBundle) {
      oInjectedBundle = oBundle;
    },

    dateTime(vValue) {
      const oDate = parseDate(vValue);
      if (!oDate) { return vValue ? String(vValue) : ""; }
      try {
        return getDateTimeFormat().format(oDate);
      } catch (e) {
        return String(vValue);
      }
    },

    sourceMeta(sType, sAddedAt) {
      const sTypeLabel = getText(
        sType === "news" ? "SOURCE_LABEL_NEWS" : "SOURCE_LABEL_FILE",
        null,
        sType === "news" ? "Новость" : "Файл"
      );
      if (!sAddedAt) { return sTypeLabel; }
      const oDate = parseDate(sAddedAt);
      if (!oDate) { return sTypeLabel; }
      try {
        return sTypeLabel + " · " + getTimeFormat().format(oDate);
      } catch (e) {
        return sTypeLabel;
      }
    },

    statusClass(sStatus) {
      const m = statusMeta(sStatus);
      return m ? m.cls : "ebStatusUnknown";
    },

    statusLabel(sStatus) {
      const m = statusMeta(sStatus);
      return m ? getText(m.key, null, m.fallback) : "—";
    },

    statusState(sStatus) {
      const m = statusMeta(sStatus);
      return m ? m.state : "None";
    },

    statusIcon(sStatus) {
      const m = statusMeta(sStatus);
      return m ? m.icon : "sap-icon://hint";
    },

    statusWidth(iCount, iTotal) {
      const c = Number(iCount) || 0;
      const t = Number(iTotal) || 0;
      if (t <= 0) { return "0%"; }
      return Math.round((c / t) * 100) + "%";
    },

    recipientsSummary(aRecipients) {
      const c = (aRecipients || []).length;
      if (c <= 0) {
        return getText("RECIPIENTS_SUMMARY_EMPTY", null, "Нет получателей — нажмите, чтобы добавить");
      }
      return getText("RECIPIENTS_SUMMARY", [c], c + " получателей — нажмите для просмотра");
    },

    newsSummary(aNews) {
      const c = (aNews || []).length;
      if (c <= 0) {
        return getText("NEWS_SUMMARY_EMPTY", null, "Нет новостей — нажмите, чтобы добавить");
      }
      return getText("NEWS_SUMMARY", [c], c + " новостей — нажмите для просмотра");
    },

    /**
     * Sanitizes HTML for safe rendering inside sap.m.FormattedText.
     *
     * @param {string} sHtml raw HTML from backend / draft
     * @returns {string} sanitized HTML
     */
    sanitizedHtml(sHtml) {
      if (!sHtml) { return ""; }
      return Sanitize.forImport(sHtml);
    },

    /**
     * Substitutes a numeric count into an i18n template with `{0}`.
     *
     * @param {string} sTemplate raw i18n text, e.g. "Всего: {0}"
     * @param {number|string} vCount the count to substitute
     * @returns {string} formatted text
     */
    formatCount(sTemplate, vCount) {
      const n = (vCount === undefined || vCount === null) ? 0 : (Number(vCount) || 0);
      if (!sTemplate || typeof sTemplate !== "string") { return String(n); }
      return sTemplate.replace(/\{0\}/g, String(n));
    }
  };

  return Formatter;
});
