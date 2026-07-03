sap.ui.define([
  "sap/ui/core/format/DateFormat",
  "sap/base/Log",
  "sap/base/security/encodeXML",
  "emailbuilder/util/sanitize",
  "emailbuilder/util/sourceBlock"
], (DateFormat, Log, encodeXML, Sanitize, SourceBlock) => {
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

  /**
   * Picks the grammatically correct noun form for a count, Russian plural
   * rules (1 / 2-4 / 5-20,0 exceptions) vs. simple English singular/plural.
   *
   * @param {number} n count
   * @param {string} sOne RU form for n=1 (e.g. "получатель")
   * @param {string} sFew RU form for n=2..4 (e.g. "получателя")
   * @param {string} sMany RU form for n=0,5-20,... (e.g. "получателей")
   * @param {string} sSingularEn EN singular (e.g. "recipient")
   * @param {string} sPluralEn EN plural (e.g. "recipients")
   * @returns {string} noun in the correct form for the active language
   */
  function pluralNoun(n, sOne, sFew, sMany, sSingularEn, sPluralEn) {
    if (sap.ui.getCore().getConfiguration().getLanguage() !== "ru") {
      return n === 1 ? sSingularEn : sPluralEn;
    }
    const iMod10 = n % 10;
    const iMod100 = n % 100;
    if (iMod10 === 1 && iMod100 !== 11) { return sOne; }
    if (iMod10 >= 2 && iMod10 <= 4 && (iMod100 < 10 || iMod100 >= 20)) { return sFew; }
    return sMany;
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
      const bIsNews = sType === SourceBlock.TYPE.NEWS;
      const sTypeLabel = getText(
        bIsNews ? "SOURCE_LABEL_NEWS" : "SOURCE_LABEL_FILE",
        null,
        bIsNews ? "Новость" : "Файл"
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

    /**
     * Combined "Label (Count)" text for a status chip.
     *
     * @param {string} sStatus status code
     * @param {number} iCount count for that status
     * @returns {string} chip text
     */
    statusChipText(sStatus, iCount) {
      const m = statusMeta(sStatus);
      const sLabel = m ? getText(m.key, null, m.fallback) : "—";
      return sLabel + " (" + (iCount || 0) + ")";
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
      const sNoun = pluralNoun(c, "получатель", "получателя", "получателей", "recipient", "recipients");
      return getText("RECIPIENTS_SUMMARY", [c, sNoun], c + " " + sNoun + " — нажмите для просмотра");
    },

    newsSummary(aNews) {
      const c = (aNews || []).length;
      if (c <= 0) {
        return getText("NEWS_SUMMARY_EMPTY", null, "Нет новостей — нажмите, чтобы добавить");
      }
      const sNoun = pluralNoun(c, "новость", "новости", "новостей", "news item", "news items");
      return getText("NEWS_SUMMARY", [c, sNoun], c + " " + sNoun + " — нажмите для просмотра");
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
     * Builds the editor-ready HTML block for a single News/NewsSet entry.
     * When IsChange="X" (see ZCDS_News), this reproduces the CHG-announcement
     * layout from the reference template — bold change number, bold
     * "Инициатор: ФИО, Организация" and "Область изменения: ..." lines,
     * then the body paragraph — instead of just dumping Content raw. A
     * regular (non-change) news item keeps the old plain-Content behavior
     * unchanged.
     *
     * ChangeNumber/InitiatorName/InitiatorOrg/Area are plain OData string
     * fields (not HTML) and are XML-encoded here; Content is HTML and goes
     * through Sanitize.forImport like before.
     *
     * Styling is INLINE, not a CSS class: this block ends up embedded in the
     * outgoing email body (see util/emailComposer.js), which strips <style>
     * tags and isn't served css/style.css — a recipient's mail client has no
     * app stylesheet to resolve a class against, only what travels in the
     * markup itself.
     *
     * @param {object} oNews News/NewsSet entity (Title, Area, Content,
     *   IsChange, ChangeNumber, InitiatorName, InitiatorOrg)
     * @returns {string} sanitized HTML ready for SourceBlock.wrap
     */
    newsContentHtml(oNews) {
      const sContent = Sanitize.forImport((oNews && oNews.Content) || "");
      if (!oNews || oNews.IsChange !== "X") {
        return sContent;
      }

      const aParts = ['<div style="margin:0 0 12px;">'];

      if (oNews.ChangeNumber) {
        aParts.push(
          '<p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#0070f2;text-align:center;">',
          encodeXML(oNews.ChangeNumber),
          '</p>'
        );
      }

      const sInitiator = [oNews.InitiatorName, oNews.InitiatorOrg]
        .filter(Boolean).map(encodeXML).join(", ");
      if (sInitiator) {
        aParts.push(
          '<p style="margin:0 0 4px;"><strong>', getText("NEWS_INITIATOR", null, "Инициатор"), ': </strong>',
          sInitiator, '</p>'
        );
      }

      if (oNews.Area) {
        aParts.push(
          '<p style="margin:0 0 10px;"><strong>', getText("NEWS_CHANGE_AREA", null, "Область изменения"), ': </strong>',
          encodeXML(oNews.Area), '</p>'
        );
      }

      aParts.push(sContent);
      aParts.push('</div>');
      return aParts.join("");
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
