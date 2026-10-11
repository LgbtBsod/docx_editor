// SSOT for OData date parsing — used by DialogMixin (mailings filter) and
// model/formatter.js (display formatting), so a format change is one edit.
sap.ui.define([], () => {
  "use strict";

  // Handles /Date(ms)/, ISO-8601, epoch number and Date instances.
  function parseODataDate(v) {
    if (v instanceof Date) { return isNaN(v.getTime()) ? null : v; }
    if (typeof v === "number") { return isNaN(v) ? null : new Date(v); }
    if (typeof v === "string") {
      const m = v.match(/\/Date\((-?\d+)(?:[+-]\d+)?\)\//);
      if (m) { return new Date(parseInt(m[1], 10)); }
      const ms = Date.parse(v);
      return isNaN(ms) ? null : new Date(ms);
    }
    return null;
  }

  return { parseODataDate: parseODataDate };
});