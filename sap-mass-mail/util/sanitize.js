sap.ui.define([
  "sap/base/Log"
], (Log) => {
  "use strict";

  /**
   * List of allowed HTML tags for email content.
   */
  const ALLOWED_TAGS = [
    "p", "br", "hr", "div", "span", "a", "img",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tr", "td", "th",
    "strong", "b", "em", "i", "u", "s", "sub", "sup", "small",
    "blockquote", "pre", "code",
    "font", "center"
  ];

  const ALLOWED_ATTR = [
    "style", "class", "align", "dir",
    "href", "title", "target", "rel",
    "src", "alt", "width", "height",
    "colspan", "rowspan", "scope",
    "cellpadding", "cellspacing", "border", "bgcolor",
    "color", "size", "face"
  ];

  const ALLOWED_PROTOCOLS = ["http", "https", "mailto", "tel", "cid"];

  /**
   * Context of the current sanitize run. DOMPurify hooks are global and
   * registered once; per-run behaviour is switched via this module state.
   * @type {{harden:boolean, hosts:string[]}|null}
   */
  let oHookContext = null;
  let bHooksRegistered = false;

  function hasDomPurify() {
    return !!(window.DOMPurify && typeof window.DOMPurify.sanitize === "function"
      && typeof window.DOMPurify.addHook === "function");
  }

  /**
   * Returns true if the URL uses an allowed protocol (or is relative).
   *
   * @param {string} sUrl URL to check
   * @returns {boolean} true when allowed
   */
  function isAllowedProtocol(sUrl) {
    if (!sUrl) { return false; }
    const sLower = sUrl.toLowerCase().trim();
    if (sLower.indexOf(":") < 0) { return true; } // relative
    return ALLOWED_PROTOCOLS.some((sProto) => sLower.indexOf(sProto + ":") === 0);
  }

  /**
   * Checks whether an absolute http(s) URL host is allowlisted.
   * FAIL-CLOSED: an empty allowlist or an unparseable URL rejects the host.
   * Non-http URLs (mailto/tel/cid/relative) are protocol-gated elsewhere.
   *
   * @param {string} sUrl URL to check
   * @param {string[]} aAllowedHosts list of allowed hostnames
   * @returns {boolean} true when host is allowed
   */
  function isHostAllowed(sUrl, aAllowedHosts) {
    const sLower = (sUrl || "").toLowerCase().trim();
    if (sLower.indexOf("http") !== 0) { return true; }
    if (!aAllowedHosts || aAllowedHosts.length === 0) { return false; }
    try {
      return aAllowedHosts.indexOf(new URL(sUrl).hostname) >= 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * Registers the single global DOMPurify hook that hardens links and images
   * on the DOM level (replaces the former regex-based post-processing, which
   * produced malformed markup and destroyed data: images).
   *
   * @private
   */
  function registerHooks() {
    if (bHooksRegistered || !hasDomPurify()) { return; }
    bHooksRegistered = true;

    window.DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (!oHookContext || !oHookContext.harden) { return; }

      if (node.tagName === "A") {
        const sHref = node.getAttribute("href") || "";
        if (!isAllowedProtocol(sHref) || !isHostAllowed(sHref, oHookContext.hosts)) {
          node.removeAttribute("href");
        } else if (sHref.toLowerCase().indexOf("mailto:") !== 0) {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
        return;
      }

      if (node.tagName === "IMG") {
        const sSrc = node.getAttribute("src") || "";
        const bDataImage = /^data:image\//i.test(sSrc); // embedded editor images are legal
        if (!bDataImage && (!isAllowedProtocol(sSrc) || !isHostAllowed(sSrc, oHookContext.hosts))) {
          node.removeAttribute("src");
        }
      }
    });
  }

  function buildBaseConfig() {
    return {
      ALLOWED_TAGS: ALLOWED_TAGS.slice(),
      ALLOWED_ATTR: ALLOWED_ATTR.slice(),
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form",
        "input", "textarea", "select", "button"],
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false
    };
  }

  /**
   * Sanitizes HTML using DOMPurify. If DOMPurify is unavailable, returns an
   * empty string for safety (never returns unsanitized HTML).
   *
   * @param {string} sHtml raw HTML
   * @param {{harden:boolean, hosts:string[]}} oContext hook context for this run
   * @returns {string} sanitized HTML or empty string
   * @private
   */
  function sanitizeWithDomPurify(sHtml, oContext) {
    if (!hasDomPurify()) {
      Log.error("[emailbuilder] DOMPurify not available; refusing to render untrusted HTML.");
      return "";
    }
    registerHooks();
    oHookContext = oContext;
    try {
      return window.DOMPurify.sanitize(sHtml, buildBaseConfig());
    } catch (e) {
      Log.error("[emailbuilder] DOMPurify sanitize failed: " + e.message);
      return "";
    } finally {
      oHookContext = null;
    }
  }

  /**
   * Sanitizes untrusted HTML for insertion into the editor.
   *
   * @param {string} sHtml raw HTML
   * @returns {string} sanitized HTML
   */
  function forImport(sHtml) {
    return sHtml ? sanitizeWithDomPurify(sHtml, { harden: false, hosts: [] }) : "";
  }

  /**
   * Sanitizes and hardens HTML for the outgoing email body: link/image hosts
   * are enforced against the allowlist, external links get rel=noopener.
   *
   * @param {string} sHtml raw editor HTML
   * @param {string[]} aAllowedHosts allowed hostnames
   * @returns {string} sanitized, hardened HTML
   */
  function forEmail(sHtml, aAllowedHosts) {
    return sHtml ? sanitizeWithDomPurify(sHtml, { harden: true, hosts: aAllowedHosts || [] }) : "";
  }

  return {
    forImport: forImport,
    forEmail: forEmail,
    isHostAllowed: isHostAllowed,
    isAllowedProtocol: isAllowedProtocol,
    ALLOWED_TAGS: ALLOWED_TAGS
  };
});
