sap.ui.define([
  "sap/base/Log",
  "MAILING_CONSTRUCTOR/util/constants"
], (Log, Constants) => {
  "use strict";

  // DOMPurify hooks are global and registered once; per-run behaviour
  // (harden/hosts) is switched via this module state instead.
  let oHookContext = null;
  let bHooksRegistered = false;

  function hasDomPurify() {
    return !!(window.DOMPurify && typeof window.DOMPurify.sanitize === "function"
      && typeof window.DOMPurify.addHook === "function");
  }

  // Protocol-relative ("//host/...") and backslash ("\\host\...", some
  // browsers normalize this the same way) forms carry no literal scheme,
  // but the browser resolves them against the CURRENT page's protocol and
  // fetches from the named host exactly like an explicit http(s) URL —
  // they must be gated the same way, not treated as scheme-less/relative.
  function isNetworkRelative(sTrimmed) {
    return /^(\/\/|\\\\)/.test(sTrimmed);
  }

  function isAllowedProtocol(sUrl) {
    if (!sUrl) { return false; }
    const sTrimmed = sUrl.trim();
    if (isNetworkRelative(sTrimmed)) {
      return Constants.SECURITY.ALLOWED_PROTOCOLS.some((sProto) => sProto === "http" || sProto === "https");
    }
    const sLower = sTrimmed.toLowerCase();
    if (!sLower.includes(":")) { return true; }
    return Constants.SECURITY.ALLOWED_PROTOCOLS.some(
      (sProto) => sLower.startsWith(sProto + ":")
    );
  }

  // FAIL-CLOSED: an empty allowlist or an unparseable URL rejects the host.
  // Non-http URLs (mailto/tel/cid/genuinely-relative) are protocol-gated
  // elsewhere and have no host of their own to check here.
  function isHostAllowed(sUrl, aAllowedHosts) {
    const sTrimmed = (sUrl || "").trim();
    const bNetworkRelative = isNetworkRelative(sTrimmed);
    if (!bNetworkRelative && !sTrimmed.toLowerCase().startsWith("http")) { return true; }
    if (!aAllowedHosts || aAllowedHosts.length === 0) { return false; }
    try {
      // Protocol-relative/backslash forms have no scheme of their own to
      // parse directly — resolve against a fixed https base purely to
      // extract the real hostname via the URL API (the scheme itself was
      // already checked by isAllowedProtocol).
      const oUrl = bNetworkRelative
        ? new URL(sTrimmed.replace(/^\\\\/, "//"), "https://sentinel.invalid/")
        : new URL(sTrimmed);
      return aAllowedHosts.includes(oUrl.hostname);
    } catch (e) {
      return false;
    }
  }

  function registerHooks() {
    if (bHooksRegistered || !hasDomPurify()) { return; }
    bHooksRegistered = true;

    window.DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      // ALLOWED_ATTR permits `style` (needed for docx/pdf import to keep
      // direct formatting), but DOMPurify does not parse CSS values: a raw
      // url(...) inside it is an unattributable network request the moment
      // the HTML renders. Strip to "none" if the host isn't allowlisted;
      // data: URIs are always fine. Runs unconditionally — isHostAllowed()
      // fails closed on the empty host list forImport passes, so import
      // strips everything while forEmail keeps only allowlisted hosts.
      if (node.getAttribute && node.hasAttribute("style")) {
        const sStyle = node.getAttribute("style") || "";
        if (/url\s*\(/i.test(sStyle)) {
          const sHosts = (oHookContext && oHookContext.hosts) || [];
          const sSafeStyle = sStyle.replace(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (sMatch, sQuote, sUrl) => {
            const sTrimmed = (sUrl || "").trim();
            if (/^data:/i.test(sTrimmed)) { return sMatch; } // inline, no network request
            if (!isAllowedProtocol(sTrimmed) || !isHostAllowed(sTrimmed, sHosts)) { return "none"; }
            return sMatch;
          });
          node.setAttribute("style", sSafeStyle);
        }
      }

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
      ALLOWED_TAGS: Constants.SECURITY.ALLOWED_HTML_TAGS.slice(),
      ALLOWED_ATTR: Constants.SECURITY.ALLOWED_ATTR.slice(),
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form",
        "input", "textarea", "select", "button"],
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false
    };
  }

  // Never returns unsanitized HTML — an unavailable DOMPurify fails to "".
  function sanitizeWithDomPurify(sHtml, oContext) {
    if (!hasDomPurify()) {
      Log.error("[MAILING_CONSTRUCTOR] DOMPurify not available; refusing to render untrusted HTML.");
      return "";
    }
    registerHooks();
    oHookContext = oContext;
    try {
      return window.DOMPurify.sanitize(sHtml, buildBaseConfig());
    } catch (e) {
      Log.error("[MAILING_CONSTRUCTOR] DOMPurify sanitize failed: " + e.message);
      return "";
    } finally {
      oHookContext = null;
    }
  }

  function forImport(sHtml) {
    return sHtml ? sanitizeWithDomPurify(sHtml, { harden: false, hosts: [] }) : "";
  }

  // Unlike forImport, also enforces the host allowlist on links/images and
  // adds rel=noopener to external links — this is the outgoing email path.
  function forEmail(sHtml, aAllowedHosts) {
    return sHtml ? sanitizeWithDomPurify(sHtml, { harden: true, hosts: aAllowedHosts || [] }) : "";
  }

  return {
    forImport: forImport,
    forEmail: forEmail,
    isHostAllowed: isHostAllowed,
    isAllowedProtocol: isAllowedProtocol,

    // Called from Component#destroy — leaves no global side effects after unload.
    removeHooks() {
      if (bHooksRegistered && typeof window.DOMPurify !== "undefined") {
        try { window.DOMPurify.removeHook("afterSanitizeAttributes"); } catch (e) { /* ignore */ }
        bHooksRegistered = false;
      }
    }
  };
});

