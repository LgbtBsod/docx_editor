"use strict";

/**
 * Minimal dev server for local testing — no external dependencies.
 *
 * Serves the app's static files (matching index.html's
 * data-sap-ui-resourceroots mapping MAILING_CONSTRUCTOR -> "/ui5/") and
 * implements POST /api/save-email, the endpoint util/mockBackend.js already
 * calls after every mock send. Each send gets dropped as a JSON file under
 * saved_emails/ so a sent mailing (recipients, subject, HTML content,
 * attachments) can be inspected/"replayed" outside the browser — the piece
 * that was previously a no-op 404 with no server behind it.
 *
 * Run: node server.js  (see .claude/launch.json, port 8001)
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 8001;
const ROOT = __dirname;
const SAVED_EMAILS_DIR = path.join(ROOT, "saved_emails");
// The client's own MAX_TOTAL_ATTACHMENTS_SIZE (util/config.js) caps RAW
// attachment bytes at 20MB, but this body carries them base64-encoded
// (~4/3 inflation, ~26.7MB) plus JSON structure/Subject/HTML Content/
// recipient list on top — a mailing right at the client's own advertised
// limit must not be rejected here.
const MAX_SAVE_BODY_BYTES = 40 * 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".properties": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function sendJson(res, statusCode, body) {
  const sBody = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(sBody)
  });
  res.end(sBody);
}

function serveStaticFile(res, absPath) {
  fs.readFile(absPath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found: " + absPath);
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypeFor(absPath) });
    res.end(data);
  });
}

// "/"        -> index.html
// "/ui5/..." -> project-root-relative file (mirrors index.html's
//               data-sap-ui-resourceroots: {"MAILING_CONSTRUCTOR": "/ui5/"})
// Anything else -> null (404) — this is a dev-only static server for this
// one app, not a general file host.
function resolveStaticPath(pathname) {
  if (pathname === "/" || pathname === "") {
    return path.join(ROOT, "index.html");
  }
  if (pathname.indexOf("/ui5/") === 0) {
    const sRelative = decodeURIComponent(pathname.slice("/ui5/".length));
    const sAbs = path.normalize(path.join(ROOT, sRelative));
    // Path-traversal guard: resolved path must stay under ROOT.
    if (sAbs !== ROOT && sAbs.indexOf(ROOT + path.sep) !== 0) { return null; }
    return sAbs;
  }
  return null;
}

// Mirrors what MockServer already fakes for MailHistorySet/MailContentSet,
// but keeps the full payload (including attachments and the real recipient
// list, even for test sends) on disk for manual inspection.
function handleSaveEmail(req, res) {
  // Buffers are collected and concatenated once at the end, then decoded
  // in a single toString() pass — decoding each chunk independently (the
  // previous `sBody += chunk` did this implicitly) corrupts any
  // multi-byte UTF-8 character that happens to be split across a chunk
  // boundary (silently, e.g. Cyrillic Subject/Content text becoming
  // replacement characters in the saved audit copy).
  const aChunks = [];
  let iReceived = 0;
  let bTooLarge = false;

  req.on("data", (chunk) => {
    iReceived += chunk.length;
    if (iReceived > MAX_SAVE_BODY_BYTES) {
      bTooLarge = true;
      req.destroy();
      return;
    }
    aChunks.push(chunk);
  });

  req.on("end", () => {
    if (bTooLarge) { return; } // response already skipped; connection destroyed

    let oPayload;
    try {
      oPayload = JSON.parse(Buffer.concat(aChunks).toString("utf-8"));
    } catch (e) {
      sendJson(res, 400, { error: "Invalid JSON" });
      return;
    }

    fs.mkdir(SAVED_EMAILS_DIR, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        sendJson(res, 500, { error: "Could not create saved_emails directory" });
        return;
      }

      const sSafeLocalId = String(oPayload.LocalId || "unknown").replace(/[^A-Za-z0-9_\-.]/g, "_");
      const sFileName = Date.now() + "_" + sSafeLocalId + ".json";
      const sFilePath = path.join(SAVED_EMAILS_DIR, sFileName);

      fs.writeFile(sFilePath, JSON.stringify(oPayload, null, 2), "utf-8", (writeErr) => {
        if (writeErr) {
          sendJson(res, 500, { error: "Could not save email" });
          return;
        }
        console.log("[server] Saved email: " + sFileName);
        sendJson(res, 200, { status: "ok", file: sFileName });
      });
    });
  });
}

const server = http.createServer((req, res) => {
  const oParsed = url.parse(req.url);
  const sPathname = oParsed.pathname || "/";

  if (req.method === "POST" && sPathname === "/api/save-email") {
    handleSaveEmail(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const sAbsPath = resolveStaticPath(sPathname);
  if (!sAbsPath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found: " + sPathname);
    return;
  }
  serveStaticFile(res, sAbsPath);
});

server.listen(PORT, () => {
  console.log("[server] Email Builder dev server running at http://localhost:" + PORT + "/");
  console.log("[server] Sent mailings are recorded under ./saved_emails/");
});
