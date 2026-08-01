sap.ui.define([
  "sap/base/security/encodeXML",
  "MAILING_CONSTRUCTOR/util/config",
  "MAILING_CONSTRUCTOR/util/fileTypes",
  "MAILING_CONSTRUCTOR/util/sourceBlock",
  "MAILING_CONSTRUCTOR/util/sanitize",
  "MAILING_CONSTRUCTOR/util/libLoader",
  "MAILING_CONSTRUCTOR/util/constants"
], (encodeXML, Config, FileTypes, SourceBlock, Sanitize, LibLoader, Constants) => {
  "use strict";

  function libUrl(sPath) {
    return sap.ui.require.toUrl("MAILING_CONSTRUCTOR/" + sPath);
  }

  const LIBS = {
    jszip: {
      path: "lib/docx-preview/jszip.min.js",
      check: () => !!window.JSZip
    },
    docxpreview: {
      path: "lib/docx-preview/docx-preview.min.js",
      check: () => !!(window.docx && typeof window.docx.renderAsync === "function")
    },
    marked: {
      path: "lib/marked/marked.min.js",
      check: () => !!(window.marked && typeof window.marked.parse === "function")
    },
    pdfjs: {
      path: "lib/pdfjs/pdf.min.js",
      check: () => !!window.pdfjsLib
    }
  };

  function ensureLib(sName) {
    const oLib = LIBS[sName];
    return LibLoader.load(libUrl(oLib.path), oLib.check).then(() => {
      if (sName === "pdfjs" && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = libUrl("lib/pdfjs/pdf.worker.min.js");
      }
    });
  }

  // docx-preview's UMD bundle reads the JSZip global directly (not via AMD/CommonJS),
  // so JSZip must already be on window before docx-preview.min.js executes.
  function ensureDocxPreview() {
    return ensureLib("jszip").then(() => ensureLib("docxpreview"));
  }

  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result || "");
      r.onerror = () => reject(new Error("read text failed"));
      r.readAsText(file);
    });
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result || "");
      r.onerror = () => reject(new Error("read dataurl failed"));
      r.readAsDataURL(file);
    });
  }

  function readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("read arraybuffer failed"));
      r.readAsArrayBuffer(file);
    });
  }

  function t(oBundle, sKey, aArgs) {
    if (oBundle && typeof oBundle.getText === "function") {
      try { return oBundle.getText(sKey, aArgs); } catch (e) { }
    }
    return sKey;
  }

  function process(file, sSourceId, sPdfMode, oBundle) {
    if (!file || file.size === 0) {
      return Promise.reject(new Error(t(oBundle, "FILE_EMPTY")));
    }

    const sExt = Config.getFileExt(file.name);
    const oType = FileTypes.get(sExt);
    if (!oType) {
      return Promise.reject(new Error(t(oBundle, "MSG_UNSUPPORTED_TYPE", [sExt])));
    }

    switch (oType.handler) {
      case "pdf":      return processPdf(file, sSourceId, sPdfMode || "text", oBundle);
      case "docx":     return processDocx(file, sSourceId, oBundle);
      case "markdown": return processMarkdown(file, sSourceId);
      case "html":     return processHtml(file, sSourceId);
      case "image":    return processImage(file, sSourceId);
      default:         return processText(file, sSourceId);
    }
  }

  function processText(file, sSourceId) {
    return readAsText(file).then((sText) => SourceBlock.wrap(
      sSourceId, SourceBlock.TYPE.FILE,
      "<p>" + encodeXML(sText).replace(/\n/g, "<br>") + "</p>"
    ));
  }

  function processMarkdown(file, sSourceId) {
    return Promise.all([ensureLib("marked"), readAsText(file)])
      .then((aResults) => SourceBlock.wrap(
        sSourceId, SourceBlock.TYPE.FILE,
        Sanitize.forImport(window.marked.parse(aResults[1]))
      ));
  }

  function processHtml(file, sSourceId) {
    return readAsText(file).then((sText) => {
      // DOMParser gives a real, properly-nested document; .body.innerHTML is
      // the canonical extraction. Falls back to raw text for HTML fragments.
      const oDoc = new DOMParser().parseFromString(sText, "text/html");
      const sBody = Sanitize.forImport(oDoc.body ? oDoc.body.innerHTML : sText);
      return SourceBlock.wrap(sSourceId, SourceBlock.TYPE.FILE, sBody);
    });
  }

  function processImage(file, sSourceId) {
    return readAsDataURL(file).then((sDataUrl) => {
      const sSafeName = encodeXML(file.name || "");
      const sHtml = '<p><img src="' + sDataUrl + '" alt="' + sSafeName
        + '" style="max-width:100%;height:auto;" /></p>';
      return SourceBlock.wrap(sSourceId, SourceBlock.TYPE.FILE, sHtml);
    });
  }

  function styleImportedTables(sHtml) {
    if (!sHtml || sHtml.indexOf("<table") === -1) { return sHtml; }
    try {
      const oDoc = new DOMParser().parseFromString(sHtml, "text/html");
      oDoc.querySelectorAll("table").forEach((oTable) => {
        oTable.style.borderCollapse = "collapse";
        oTable.style.width = "100%";
        oTable.style.margin = "8px 0";
      });
      oDoc.querySelectorAll("table td, table th").forEach((oCell) => {
        oCell.style.border = "1px solid " + Constants.COLORS.BORDER;
        oCell.style.padding = "6px 10px";
      });
      oDoc.querySelectorAll("table th").forEach((oHeader) => {
        oHeader.style.background = Constants.COLORS.SURFACE_ALT;
        oHeader.style.fontWeight = "600";
        oHeader.style.textAlign = "left";
      });
      return oDoc.body.innerHTML;
    } catch (e) {
      return sHtml;
    }
  }

  // docx-preview over mammoth: mammoth only converts document structure and never
  // reads direct formatting (text color, alignment) — docx-preview renders those as
  // inline styles, which is what survives both TinyMCE and an outgoing email.
  function renderDocxContent(file) {
    const oContainer = document.createElement("div");
    return window.docx.renderAsync(file, oContainer, null, {
      inWrapper: false,
      ignoreWidth: true,
      ignoreHeight: true,
      ignoreFonts: true
    }).then(() => {
      const oSection = oContainer.querySelector("section.docx");
      const sRaw = oSection ? oSection.innerHTML : oContainer.innerHTML;
      return styleImportedTables(Sanitize.forImport(sRaw));
    });
  }

  function processDocx(file, sSourceId, oBundle) {
    return ensureDocxPreview()
      .then(() => renderDocxContent(file))
      .then((sClean) => SourceBlock.wrap(sSourceId, SourceBlock.TYPE.FILE, sClean))
      .catch(() => {
        return Promise.reject(new Error(t(oBundle, "MSG_LIB_NOT_LOADED", ["docx-preview"])));
      });
  }

  function processPdf(file, sSourceId, sMode, oBundle) {
    return Promise.all([ensureLib("pdfjs"), readAsArrayBuffer(file)])
      .then((aResults) => {
        // getDocument() returns a PDFDocumentLoadingTask, not a Promise itself —
        // chaining .then() directly on it resolves immediately with the task object.
        return window.pdfjsLib.getDocument({ data: aResults[1] }).promise;
      })
      .then((oPdf) => {
        const iTotal = oPdf.numPages || 0;
        const iPages = Math.min(iTotal, Config.MAX_PDF_PAGES);
        const aPromises = [];
        for (let i = 1; i <= iPages; i++) {
          aPromises.push(renderPdfPage(oPdf, i, sMode, oBundle));
        }
        return Promise.all(aPromises).then((aHtml) => {
          let sResult = aHtml.join("");
          if (iTotal > iPages) {
            sResult += '<p style="color:' + Constants.COLORS.WARNING + ';font-size:12px;">'
              + encodeXML(t(oBundle, "PDF_PAGES_TRUNCATED", [iPages, iTotal]))
              + '</p>';
          }
          return SourceBlock.wrap(sSourceId, SourceBlock.TYPE.FILE, sResult);
        });
      });
  }

  function renderPdfPage(oPdf, iPageNum, sMode, oBundle) {
    return oPdf.getPage(iPageNum).then((oPage) => {
      return sMode === "images"
        ? renderPdfPageAsImage(oPage, iPageNum, oBundle)
        : renderPdfPageAsText(oPage, iPageNum, oBundle);
    });
  }

  function renderPdfPageAsText(oPage, iPageNum, oBundle) {
    return oPage.getTextContent().then((oTextContent) => {
      const aItems = oTextContent.items || [];
      const aLines = [];
      let sLastY = null;
      aItems.forEach((item) => {
        const y = item.transform ? item.transform[5] : 0;
        if (sLastY !== null && Math.abs(y - sLastY) > 2) {
          aLines.push("<br>");
        }
        aLines.push(encodeXML(item.str || ""));
        sLastY = y;
      });
      let sText = aLines.join("");
      if (!sText.trim()) {
        sText = "<em>" + encodeXML(t(oBundle, "PDF_NO_TEXT")) + "</em>";
      }
      const sHeader = "<p>" + encodeXML(t(oBundle, "PDF_PAGE", [iPageNum])) + "</p>";
      return SourceBlock.wrapPdfPage("", iPageNum, "text", sHeader + "<div>" + sText + "</div>");
    });
  }

  function renderPdfPageAsImage(oPage, iPageNum, oBundle) {
    const oViewport = oPage.getViewport({ scale: 1.5 });
    const oCanvas = document.createElement("canvas");
    oCanvas.width = oViewport.width;
    oCanvas.height = oViewport.height;
    const oCtx = oCanvas.getContext("2d");
    return oPage.render({ canvasContext: oCtx, viewport: oViewport }).promise.then(() => {
      const sDataUrl = oCanvas.toDataURL("image/png");
      const sHeader = "<p>" + encodeXML(t(oBundle, "PDF_PAGE", [iPageNum])) + "</p>";
      const sImgAlt = encodeXML(t(oBundle, "PDF_PAGE", [iPageNum]));
      const sImg = '<img src="' + sDataUrl + '" style="max-width:100%;height:auto;" alt="'
        + sImgAlt + '"/>';
      // Free the canvas backing store so the bitmap memory is released promptly.
      oCanvas.width = 0;
      oCanvas.height = 0;
      return SourceBlock.wrapPdfPage("", iPageNum, "images", sHeader + sImg);
    });
  }

  return {
    process: process,
    readAsDataURL: readAsDataURL,
    readAsText: readAsText,
    readAsArrayBuffer: readAsArrayBuffer
  };
});
