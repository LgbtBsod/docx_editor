/**
 * Email Builder Mock Server — Node.js backend
 * Serves static files and handles email save requests.
 * Usage: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8001;
const MAILS_DIR = path.join(__dirname, 'saved_emails');

// Ensure saved emails directory exists
if (!fs.existsSync(MAILS_DIR)) {
  fs.mkdirSync(MAILS_DIR, { recursive: true });
  console.log(`✅ Created directory: ${MAILS_DIR}`);
}

function escapeHtml(sText) {
  return String(sText == null ? '' : sText)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders a saved email payload (LocalId/Subject/Content/ToRecipients/
 * Attachments) as a standalone HTML page mimicking a real mail client, so
 * the mock-mode "send" flow can be visually verified end to end.
 */
function renderEmailPreview(data) {
  const recipients = data.ToRecipients || [];
  const attachments = data.Attachments || [];

  const toLine = recipients.length
    ? recipients.map(r => `${escapeHtml(r.name || r.FullName || '')} &lt;${escapeHtml(r.email || r.Email || '')}&gt;`).join(', ')
    : '<em>(нет получателей)</em>';

  const attachmentsLine = attachments.length
    ? attachments.map(a => {
        const href = a.base64 ? `data:${escapeHtml(a.mimeType || 'application/octet-stream')};base64,${a.base64}` : '#';
        return `<a href="${href}" download="${escapeHtml(a.name || '')}">📎 ${escapeHtml(a.name || '')}${a.sizeStr ? ' (' + escapeHtml(a.sizeStr) + ')' : ''}</a>`;
      }).join(' &nbsp; ')
    : '<em>(нет вложений)</em>';

  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(data.Subject || '(без темы)')}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; background:#eef1f4; margin:0; padding:24px; }
  .envelope { max-width:720px; margin:0 auto; background:#fff; border:1px solid #d9dde3; border-radius:8px; overflow:hidden; box-shadow:0 1px 4px rgba(15,35,65,0.08); }
  .headers { padding:16px 20px; background:#fafbfc; border-bottom:1px solid #d9dde3; font-size:13px; color:#5b738b; }
  .headers div { margin:2px 0; }
  .headers b { color:#1d2d3e; display:inline-block; min-width:80px; }
  .body { padding:20px; }
  .back { display:block; max-width:720px; margin:0 auto 12px; font-size:13px; color:#0070f2; text-decoration:none; }
  .badge { display:inline-block; background:#e76500; color:#fff; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; vertical-align:middle; }
</style></head>
<body>
  <a class="back" href="/preview">&larr; Все рассылки</a>
  <div class="envelope">
    <div class="headers">
      ${data.IsTest ? '<div><span class="badge">TEST SEND</span></div>' : ''}
      <div><b>От:</b> Система рассылок</div>
      <div><b>Кому:</b> ${toLine}</div>
      <div><b>Тема:</b> ${escapeHtml(data.Subject || '(без темы)')}</div>
      <div><b>Вложения:</b> ${attachmentsLine}</div>
      <div><b>LocalId:</b> ${escapeHtml(data.LocalId || '')}</div>
    </div>
    <div class="body">${data.Content || ''}</div>
  </div>
</body></html>`;
}

const server = http.createServer((req, res) => {
  const pathname = url.parse(req.url).pathname;
  const query = url.parse(req.url, true).query;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: Save email
  if (pathname === '/api/save-email' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `email_${data.LocalId || 'draft'}_${timestamp}.json`;
        const filepath = path.join(MAILS_DIR, filename);

        fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
        console.log(`✅ Email saved: ${filename}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, filename }));
      } catch (err) {
        console.error(`❌ Error saving email:`, err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // API: List saved emails
  if (pathname === '/api/list-emails' && req.method === 'GET') {
    try {
      const files = fs.readdirSync(MAILS_DIR).sort().reverse();
      const emails = files.map(filename => {
        const filepath = path.join(MAILS_DIR, filename);
        const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
        return {
          filename,
          timestamp: path.parse(filename).name,
          localId: content.LocalId,
          subject: content.Subject,
          recipients: (content.ToRecipients || []).length
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(emails));
    } catch (err) {
      console.error(`❌ Error listing emails:`, err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // UI: List of saved emails with links to render each as HTML
  if (pathname === '/preview' && req.method === 'GET') {
    try {
      const files = fs.readdirSync(MAILS_DIR).filter(f => f.endsWith('.json')).sort().reverse();
      const rows = files.map(filename => {
        let data = {};
        try { data = JSON.parse(fs.readFileSync(path.join(MAILS_DIR, filename), 'utf-8')); } catch (e) { /* skip unreadable */ }
        const recipientCount = (data.ToRecipients || []).length;
        const attachmentCount = (data.Attachments || []).length;
        return `<tr>
          <td>${data.IsTest ? '<span class="badge">TEST</span> ' : ''}<a href="/api/preview-email?file=${encodeURIComponent(filename)}">${escapeHtml(data.Subject || '(no subject)')}</a></td>
          <td>${escapeHtml(data.LocalId || '')}</td>
          <td>${recipientCount}</td>
          <td>${attachmentCount}</td>
          <td>${escapeHtml(filename)}</td>
        </tr>`;
      }).join('\n');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>Сохранённые рассылки — превью</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; background:#f5f6f7; color:#1d2d3e; margin:0; padding:32px; }
  h1 { font-size:18px; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #d9dde3; border-radius:8px; overflow:hidden; }
  th, td { padding:10px 14px; text-align:left; border-bottom:1px solid #d9dde3; font-size:13px; }
  th { background:#fafbfc; color:#5b738b; font-weight:600; }
  a { color:#0070f2; text-decoration:none; }
  a:hover { text-decoration:underline; }
  tr:last-child td { border-bottom:none; }
  .badge { display:inline-block; background:#e76500; color:#fff; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; vertical-align:middle; }
</style></head>
<body>
  <h1>Сохранённые рассылки (${files.length})</h1>
  <table>
    <tr><th>Тема</th><th>LocalId</th><th>Получатели</th><th>Вложения</th><th>Файл</th></tr>
    ${rows || '<tr><td colspan="5">Нет сохранённых рассылок</td></tr>'}
  </table>
</body></html>`);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error: ' + err.message);
    }
    return;
  }

  // API: Render a single saved email JSON as an actual HTML email preview —
  // lets you see what a mailing would really look like without a mail client.
  if (pathname === '/api/preview-email' && req.method === 'GET') {
    const filename = query.file;
    if (!filename || filename.includes('..') || path.isAbsolute(filename)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid file parameter');
      return;
    }
    const filepath = path.join(MAILS_DIR, filename);
    fs.readFile(filepath, 'utf-8', (err, raw) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Email not found: ' + filename);
        return;
      }
      try {
        const data = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderEmailPreview(data));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error rendering email: ' + e.message);
      }
    });
    return;
  }

  // Static files
  let filePath = path.join(__dirname, decodeURIComponent(pathname));
  if (pathname === '/') filePath = path.join(__dirname, 'index.html');

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath);
    const contentTypeMap = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.gif': 'image/gif',
      '.xml': 'application/xml',
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`\n📧 Email Builder Server running on http://localhost:${PORT}`);
  console.log(`💾 Emails saved to: ${MAILS_DIR}\n`);
});
