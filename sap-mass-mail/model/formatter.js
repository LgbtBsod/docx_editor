sap.ui.define([
  "sap/ui/core/format/DateFormat",
  "sap/base/Log",
  "sap/base/security/encodeXML",
  "MAILING_CONSTRUCTOR/util/sanitize",
  "MAILING_CONSTRUCTOR/util/sourceBlock",
  "MAILING_CONSTRUCTOR/util/dateUtils",
  "MAILING_CONSTRUCTOR/util/constants"
], (DateFormat, Log, encodeXML, Sanitize, SourceBlock, DateUtils, Constants) => {
  "use strict";

  let oDateTimeFormat = null;
  let oTimeFormat = null;

  /**
   * Resource bundle injected by the controller (Formatter.setResourceBundle).
   * @type {sap.base.i18n.ResourceBundle|null}
   */
  let oInjectedBundle = null;

  /**
   * Looks up a status entry from the "dict" JSONModel (loaded once from
   * ServiceDictSet at Component init). Searches MAIL_STATUS first (root
   * statuses on the mailings grid), then DISP_STATUS (display statuses
   * from ZI_Mailing_Status aggregation), then REC_STATUS.
   *
   * @param {string} sStatus the status code to look up
   * @returns {object|null} the dict entry {DictKey, DictText, UiState, UiIcon, CssClass}
   * @private
   */
  function dictLookup(sStatus) {
    const oComp = sap.ui.getCore().getComponent("MAILING_CONSTRUCTOR");
    if (!oComp) { return null; }
    const oDict = oComp.getModel("dict");
    if (!oDict) { return null; }
    const sCode = String(sStatus);
    const aGroups = ["MAIL_STATUS", "DISP_STATUS", "REC_STATUS"];
    for (let i = 0; i < aGroups.length; i++) {
      const aEntries = oDict.getProperty("/" + aGroups[i]) || [];
      const oFound = aEntries.find((e) => e.DictKey === sCode);
      if (oFound) { return oFound; }
    }
    return null;
  }

  /**
   * Delegates to the shared dateUtils module (SSOT for OData date parsing).
   * @param {string|number|Date} vValue value to parse
   * @returns {Date|null} parsed date or null
   * @private
   */
  function parseDate(vValue) {
    if (vValue === null || vValue === undefined || vValue === "") { return null; }
    return DateUtils.parseODataDate(vValue);
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
        Log.warning("[MAILING_CONSTRUCTOR] i18n key missing: " + sKey);
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
      const m = dictLookup(sStatus);
      return m && m.CssClass ? m.CssClass : "ebStatusUnknown";
    },

    statusLabel(sStatus) {
      const m = dictLookup(sStatus);
      return m ? m.DictText : String(sStatus || "—");
    },

    /** Alias for statusLabel — used in MailingsDialog ObjectStatus. */
    statusText(sStatus) {
      return Formatter.statusLabel(sStatus);
    },

    statusState(sStatus) {
      const m = dictLookup(sStatus);
      return m && m.UiState ? m.UiState : "None";
    },

    statusIcon(sStatus) {
      const m = dictLookup(sStatus);
      return m && m.UiIcon ? m.UiIcon : "sap-icon://hint";
    },

    /**
     * Combined "Label (Count)" text for a status chip.
     *
     * @param {string} sStatus status code
     * @param {number} iCount count for that status
     * @returns {string} chip text
     */
    statusChipText(sStatus, iCount) {
      const m = dictLookup(sStatus);
      const sLabel = m ? m.DictText : "—";
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
     * layout (bold change number, "Инициатор: ...", "Область изменения: ...",
     * body). Other news items render plain sanitized Content.
     *
     * Styling is INLINE (not a CSS class): this block travels in the outgoing
     * email body where no app stylesheet resolves.
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
          '<p style="margin:0 0 8px;font-size:16px;font-weight:700;color:' + Constants.COLORS.PRIMARY + ';text-align:center;">',
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
    /**
     * Clears the cached bundle and format instances.
     * Called from Component#destroy to prevent stale singleton state
     * when the component is recreated within the same page lifecycle.
     */
    reset() {
      oInjectedBundle = null;
      oDateTimeFormat = null;
      oTimeFormat = null;
    },

    formatCount(sTemplate, vCount) {
      const n = (vCount === undefined || vCount === null) ? 0 : (Number(vCount) || 0);
      if (!sTemplate || typeof sTemplate !== "string") { return String(n); }
      return sTemplate.replace(/\{0\}/g, String(n));
    }
  };

  return Formatter;
});
