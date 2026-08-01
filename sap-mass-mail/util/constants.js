/**
 * Global constants for Email Builder application.
 * Single source of truth for validation patterns, performance limits, security rules.
 */
sap.ui.define([], () => {
  "use strict";

  return {
    VALIDATION: {
      // Unicode-aware: only checks the basic "something@something.tld" shape;
      // real deliverability is left to the backend/SMTP. Cyrillic email
      // addresses (IDN/EAI) are legitimate and common in this market.
      EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u,
      LOCAL_ID_PATTERN: /^[A-Za-z0-9_\-.]{1,40}$/,

      // Pre-load fallback ONLY. The single source of truth is the backend's
      // MailingConfigSet, loaded into the "config" model at startup
      // (App.controller#_loadMailingConfig) and bound to subjectInput's
      // maxLength there.
      SUBJECT_MAX_LEN: 50
    },

    PERFORMANCE: {
      DEFAULT_TOP: 100,
      MAX_COLLECTION_SIZE: 5000,

      // Pre-load fallback ONLY — see SUBJECT_MAX_LEN comment above; the
      // single source of truth is MailingConfigSet's MaxRecipients, applied
      // to the "state" JSONModel's sizeLimit via Component#setStateSizeLimit
      // once App.controller#_loadMailingConfig resolves.
      MAX_RECIPIENTS_PER_MAILING: 10000
    },

    STORAGE: {
      // Schema v3 (draftManager.js) strips base64 from attachments and does
      // not persist recipient PII. The prefix bump invalidates all legacy
      // drafts; a clean break is cheaper than migrating on-load.
      DRAFT_KEY_PREFIX: "eb_draft_v3"
    },

    /**
     * SSOT for the CHAR(4) status codes used across ABAP (BOPF/CDS), the
     * OData service and the UI. Mirrors ZCL_NEWSLETTER_CONSTANTS=>root_status
     * and rec_status. Every consumer of a status literal must read it here
     * so a scheme renumbering touches one file, not fifty call sites.
     *
     * Root statuses (zmail_hdr.status):
     *   001 In Queue, 010 Processing, 100 Sent OK, 900 Sent with Errors.
     * Recipient statuses (zeb_mailing_rec.status):
     *   010 New, 020 Sent, 030 Error.
     * Display statuses (ZI_Mailing_Status domain, what the UI formatter sees):
     *   001 Queue (root-only), 010 Processing, 020 Pending,
     *   040 Sent, 050 Failed, 100 Sent OK (root-only), 900 Error (root-only).
     */
    STATUS: {
      ROOT: {
        QUEUE:  "001",
        PROC:   "010",
        OK:     "100",
        ERROR:  "900"
      },
      REC: {
        NEW:    "010",
        SENT:   "020",
        ERROR:  "030"
      }
    },

    /**
     * SSOT for the CHAR(4) news-type domain (ZCDS_News.NewsType).
     * Mirrors the ABAP domain fixed values. The "Только изменения" toggle
     * in NewsSearch sends Filter("NewsType", EQ, NEWS_TYPE.CHG).
     *
     *   BASE  — Базовая рассылка
     *   NEWS  — Новости
     *   ERROR — Ошибки
     *   CHG   — Изменения
     */
    NEWS_TYPE: {
      BASE:  "BASE",
      NEWS:  "NEWS",
      ERROR: "ERROR",
      CHG:   "CHG"
    },

    /**
     * SSOT for the application's brand / semantic color palette.
     * Values are hex strings so they survive inside inline `style="color:..."`
     * attributes that travel in the outgoing email body (where no app
     * stylesheet resolves).
     */
    COLORS: {
      PRIMARY:     "#0070f2",
      INFO:        "#1d6fd1",
      TEXT:        "#1d2d3e",
      SECONDARY:   "#5b738b",
      BORDER:      "#d9dde3",
      SURFACE_ALT: "#fafbfc",
      SUCCESS:     "#36a41d",
      WARNING:     "#e76500",
      ERROR:       "#ee3939"
    },

    /**
     * SSOT for OData entity set names. Every path used in util/service.js
     * and controller/DialogMixin.js must reference these — no hardcoded
     * "/MailHeaderSet" string literals scattered across the codebase.
     * Mirrors ZCL_NEWSLETTER_CONSTANTS=>entity on the ABAP side.
     */
    ODATA: {
      SERVICE_URI: "/sap/opu/odata/sap/ZEB_MAILING_SRV/",
      ENTITY_SETS: {
        MAIL_HEADER:      "MailHeaderSet",
        MAIL_HISTORY:     "MailHistorySet",
        MAIL_CONTENT:     "MailContentSet",
        MAILING_STATUS:   "MailingStatusSet",
        MAILING_CONFIG:   "MailingConfigSet",
        RECIPIENT:        "RecipientSet",
        RECIPIENT_USER:   "RecipientUserSet",
        NEWS:             "NewsSet",
        ALLOWED_HOST:     "AllowedHostSet",
        SERVICE_DICT:     "ServiceDictSet"
      }
    },

    SECURITY: {
      ALLOWED_HTML_TAGS: [
        "p", "br", "hr", "div", "span", "a", "img",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li",
        "table", "thead", "tbody", "tr", "td", "th",
        "strong", "b", "em", "i", "u", "s", "sub", "sup", "small",
        "blockquote", "pre", "code",
        "font", "center"
      ],
      ALLOWED_ATTR: [
        "style", "class", "align", "dir",
        "href", "title", "target", "rel",
        "src", "alt", "width", "height",
        "colspan", "rowspan", "scope",
        "cellpadding", "cellspacing", "border", "bgcolor",
        "color", "size", "face"
      ],
      ALLOWED_PROTOCOLS: ["http", "https", "mailto", "tel", "cid"]
    }
  };
});
