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

  // Static files
  let filePath = path.join(__dirname, pathname);
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
