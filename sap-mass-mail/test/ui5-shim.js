/**
 * Minimal UI5 AMD shim for browser module tests.
 * Implements sap.ui.define / sap.ui.require with stubbed framework modules,
 * so app modules under emailbuilder/* run in a plain browser page.
 */
(function () {
  "use strict";

  const mModules = {};   // name -> exports
  const mFactories = {}; // name -> {deps, factory}
  let aAnonQueue = [];

  function norm(sName) { return sName.replace(/^\.\//, ""); }

  // ---- framework stubs ------------------------------------------------
  const Log = {
    _entries: [],
    info(m) { this._entries.push(["I", m]); },
    warning(m) { this._entries.push(["W", m]); },
    error(m) { this._entries.push(["E", m]); console.error("[Log.error]", m); }
  };

  function encodeXML(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function DateFormatInstance(oOpts) {
    const pad = (n) => String(n).padStart(2, "0");
    return {
      format(d) {
        if (oOpts.pattern === "HH:mm") { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
        return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear()
          + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
      }
    };
  }

  function Filter(sPath, sOp, vVal) { this.sPath = sPath; this.sOperator = sOp; this.oValue1 = vVal; }

  const stubs = {
    "sap/base/Log": Log,
    "sap/base/security/encodeXML": encodeXML,
    "sap/ui/core/format/DateFormat": { getInstance: DateFormatInstance },
    "sap/ui/core/format/FileSizeFormat": {
      getInstance() {
        return { format(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MiB" : n >= 1024 ? (n / 1024).toFixed(1) + " KiB" : n + " B"; } };
      }
    },
    "sap/ui/model/Filter": Filter,
    "sap/ui/model/FilterOperator": { Contains: "Contains", EQ: "EQ" },
    "sap/base/i18n/ResourceBundle": { create() { return null; } },
    "sap/ui/richtexteditor/RichTextEditor": function StubRTE(sId, mSettings) {
      this._id = sId; this._value = "";
      this._settings = mSettings || {};
      const that = this;
      setTimeout(() => { if (that._settings.ready) { that._settings.ready(); } }, 0);
    },
    "sap/ui/richtexteditor/library": { EditorType: { TinyMCE4: "TinyMCE4" } },
    "sap/ui/core/Fragment": {
      load() { return Promise.reject(new Error("Fragment.load not supported in shim")); },
      byId() { return null; }
    },
    "sap/ui/model/json/JSONModel": function JSONModelStub(oData) {
      this._d = oData || {};
      this.getProperty = (p) => this._d[p.slice(1)];
      this.setProperty = (p, v) => { this._d[p.slice(1)] = v; };
      this.setData = (d) => { this._d = d; };
      this.getData = () => this._d;
      this.destroy = () => {};
    },
    "sap/m/MessageToast": { show() {} },
    "sap/m/MessageBox": {
      Action: { OK: "OK", CANCEL: "CANCEL" },
      error() {}, warning() {}, success() {}, confirm() {}
    },
    "sap/m/Dialog": function DialogStub() {},
    "sap/ui/core/mvc/Controller": { extend: (n, o) => o }
  };
  // Stub RTE prototype API used by editorApi
  const RTEProto = stubs["sap/ui/richtexteditor/RichTextEditor"].prototype;
  RTEProto.getValue = function () { return this._value; };
  RTEProto.setValue = function (s) { this._value = s || ""; };
  RTEProto.getDomRef = function () { return null; };
  RTEProto.destroy = function () { this._destroyed = true; };

  Object.keys(stubs).forEach((k) => { mModules[k] = stubs[k]; });

  function req(sName) {
    sName = norm(sName);
    if (sName in mModules) { return mModules[sName]; }
    if (sName in mFactories) {
      const f = mFactories[sName];
      delete mFactories[sName];
      mModules[sName] = f.factory.apply(null, (f.deps || []).map(req));
      return mModules[sName];
    }
    throw new Error("Module not available in shim: " + sName);
  }

  window.sap = window.sap || {};
  window.sap.ui = window.sap.ui || {};

  // define: capture factory; name resolved by loader (window.__defineAs)
  window.sap.ui.define = function (deps, factory) {
    if (typeof deps === "function") { factory = deps; deps = []; }
    const sName = window.__defineAs;
    if (sName) {
      mFactories[sName] = { deps: deps, factory: factory };
    } else {
      aAnonQueue.push({ deps: deps, factory: factory });
    }
  };

  window.sap.ui.require = function (vDeps, fnCb) {
    if (typeof vDeps === "string") { return req(vDeps); }
    const mods = vDeps.map(req);
    if (fnCb) { fnCb.apply(null, mods); }
  };
  window.sap.ui.require.toUrl = function (s) { return "../" + s.replace(/^emailbuilder\//, ""); };
  window.sap.ui.getCore = function () {
    return { getConfiguration() { return { getLanguageTag() { return "ru"; } }; } };
  };

  /**
   * Loads an app module file and registers it under the given AMD name.
   */
  window.loadAppModule = function (sName, sUrl) {
    return fetch(sUrl).then((r) => {
      if (!r.ok) { throw new Error("fetch failed: " + sUrl); }
      return r.text();
    }).then((sSrc) => {
      window.__defineAs = sName;
      (new Function(sSrc))(); // eslint-disable-line no-new-func
      window.__defineAs = null;
    });
  };

  window.__req = req;
  window.__Log = Log;
})();
