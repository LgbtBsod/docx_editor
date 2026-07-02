sap.ui.define([
  "sap/base/security/encodeXML",
  "emailbuilder/util/config",
  "emailbuilder/util/fileTypes",
  "emailbuilder/util/sourceBlock",
  "emailbuilder/util/sanitize",
  "emailbuilder/util/libLoader"
], (encodeXML, Config, FileTypes, SourceBlock, Sanitize, LibLoader) => {
  "use strict";

  /**
   * Resolves an app-local path through the UI5 resource roots, so lazy
   * loading works from any document URL (standalone AND Fiori Launchpad,
   * where the page URL is the shell, not the app folder).
   *
   * @param {string} sPath path relative to the app root
   * @returns {string} resolved URL
   * @private
   */
  function libUrl(sPath) {
    return sap.ui.require.toUrl("emailbuilder/" + sPath);
  }

  /**
   * Third-party libraries, lazy-loaded on first use (~2 MB off cold start).
   */
  const LIBS = {
    mammoth: {
      path: "lib/mammoth/mammoth.browser.min.js",
      check: () => !!(window.mammoth && typeof window.mammoth.convertToHtml === "function")
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

  /**
   * mammoth.js style map: preserves headings and emphasis without the former
   * hand-written ZIP/OOXML parser (~450 lines removed; mammoth also embeds
   * package-internal images as data URLs by default).
   */
  const DOCX_OPTIONS = {
    styleMap: [
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "p[style-name='Heading 4'] => h4:fresh",
      "r[style-name='Strong'] => strong"
    ],
    includeDefaultStyleMap: true
  };

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

  /**
   * Translates a key via the given resource bundle (defensive).
   *
   * @param {sap.base.i18n.ResourceBundle} oBundle resource bundle
   * @param {string} sKey i18n key
   * @param {Array} [aArgs] format arguments
   * @returns {string} translated text or the key when missing
   * @private
   */
  function t(oBundle, sKey, aArgs) {
    if (oBundle && typeof oBundle.getText === "function") {
      try { return oBundle.getText(sKey, aArgs); } catch (e) { /* ignore */ }
    }
    return sKey;
  }

  /**
   * Processes a file and returns HTML to insert into the editor.
   * Dispatch is driven by the fileTypes registry (SSOT).
   *
   * @param {File} file file to process
   * @param {string} sSourceId unique source id
   * @param {string|null} sPdfMode "text" | "images" | null
   * @param {sap.base.i18n.ResourceBundle} oBundle i18n bundle
   * @returns {Promise<string>} HTML content
   */
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
      sSourceId, "file", file.name,
      "<p>" + encodeXML(sText).replace(/\n/g, "<br>") + "</p>"
    ));
  }

  function processMarkdown(file, sSourceId) {
    return Promise.all([ensureLib("marked"), readAsText(file)])
      .then((aResults) => SourceBlock.wrap(
        sSourceId, "file", file.name,
        Sanitize.forImport(window.marked.parse(aResults[1]))
      ));
  }

  function processHtml(file, sSourceId) {
    return readAsText(file).then((sText) => {
      const mBody = sText.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const sBody = Sanitize.forImport(mBody ? mBody[1] : sText);
      return SourceBlock.wrap(sSourceId, "file", file.name, sBody);
    });
  }

  function processImage(file, sSourceId) {
    return readAsDataURL(file).then((sDataUrl) => {
      const sSafeName = encodeXML(file.name || "");
      const sHtml = '<p><img src="' + sDataUrl + '" alt="' + sSafeName
        + '" style="max-width:100%;height:auto;" /></p>';
      return SourceBlock.wrap(sSourceId, "file", file.name, sHtml);
    });
  }

  function processDocx(file, sSourceId, oBundle) {
    return Promise.all([ensureLib("mammoth"), readAsArrayBuffer(file)])
      .then((aResults) => window.mammoth.convertToHtml({ arrayBuffer: aResults[1] }, DOCX_OPTIONS))
      .then((oResult) => SourceBlock.wrap(
        sSourceId, "file", file.name,
        Sanitize.forImport((oResult && oResult.value) || "")
      ))
      .catch(() => {
        return Promise.reject(new Error(t(oBundle, "MSG_LIB_NOT_LOADED", ["mammoth"])));
      });
  }

  function processPdf(file, sSourceId, sMode, oBundle) {
    return Promise.all([ensureLib("pdfjs"), readAsArrayBuffer(file)])
      .then((aResults) => {
        // getDocument() returns a PDFDocumentLoadingTask, not a Promise —
        // chaining .then() on the task itself resolves immediately with the
        // task object (0 pages rendered). Must use .promise.
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
            sResult += '<p style="color:#e76500;font-size:12px;">'
              + encodeXML(t(oBundle, "PDF_PAGES_TRUNCATED", [iPages, iTotal]))
              + '</p>';
          }
          return SourceBlock.wrap(sSourceId, "file", file.name, sResult);
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
      // Free canvas backing store so the bitmap memory is released promptly.
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
