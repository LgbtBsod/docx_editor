/**
 * Shared OData date parsing utility.
 * Single source of truth — used by DialogMixin (mailings filter)
 * and model/formatter.js (display formatting).
 */
sap.ui.define([], () => {
  "use strict";

  /**
   * Parses an OData /Date(ms)/ string, ISO-8601 string, epoch number or
   * Date instance into a Date. Returns null when unparseable.
   *
   * @param {string|number|Date} v any OData date representation
   * @returns {Date|null}
   */
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