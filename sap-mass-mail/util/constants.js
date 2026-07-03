/**
 * Global constants for Email Builder application.
 * Single source of truth for validation patterns, performance limits, security rules.
 */
sap.ui.define([], () => {
  "use strict";

  return {
    VALIDATION: {
      // Unicode-aware: the ASCII-only pattern this used to mirror from ABAP
      // zcl_eb_constants rejected every recipient in the app's own mock
      // data (Cyrillic local parts, e.g. "кузнецов.николай@company.com"),
      // making Send/Test send untestable end to end. Cyrillic email
      // addresses are legitimate (IDN/EAI) and common in this market, so
      // this only checks the basic "something@something.tld" shape and
      // leaves real deliverability to the backend/SMTP.
      EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u,
      LOCAL_ID_PATTERN: /^[A-Za-z0-9_\-.]{1,40}$/,

      // Mirrors zcl_eb_mailing_dpc_ext=>c_validation-max_subject_len (SO_OBJ_DES
      // length — outbound BCS document truncates above this). Bound to
      // subjectInput's maxLength so the limit is enforced before submit,
      // not only rejected by the backend after a full compose cycle.
      SUBJECT_MAX_LEN: 50
    },

    PERFORMANCE: {
      DEFAULT_TOP: 100,
      MAX_COLLECTION_SIZE: 5000,

      // Mirrors zcl_eb_mailing_dpc_ext=>c_validation-max_recipients (ABAP).
      // Must stay >= the "state" JSONModel's sizeLimit (Component.js), or
      // the "Добавлено" recipients list in RecipientSearch silently
      // truncates past this many entries instead of just rendering slowly.
      MAX_RECIPIENTS_PER_MAILING: 10000
    },

    STORAGE: {
      DRAFT_KEY_PREFIX: "eb_draft_v1"
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
