/**
 * Global constants for Email Builder application.
 * Single source of truth for validation patterns, performance limits, security rules.
 */
sap.ui.define([], () => {
  "use strict";

  return {
    VALIDATION: {
      // Synchronized with ABAP zcl_eb_constants
      EMAIL_PATTERN: /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/,
      LOCAL_ID_PATTERN: /^[A-Za-z0-9_\-.]{1,40}$/
    },

    PERFORMANCE: {
      DEFAULT_TOP: 100,
      MAX_COLLECTION_SIZE: 5000
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
