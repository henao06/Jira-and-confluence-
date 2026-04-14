/**
 * Servidor local QA — Hybred
 * Ejecutar: node Server.JS
 * Luego abrir: http://localhost:3000
 * No requiere dependencias externas — solo Node.js
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT       = 3000;
const JIRA_HOST  = 'liceopinoverde.atlassian.net';
const JIRA_EMAIL = 'sebastian.zapata.h@hybred.edu.co';
const JIRA_TOKEN = 'ATATT3xFfGF0ETjglczxpGdHrIRBJzGGJG-hsEoiCZ0bIB8oofsD0gjNaz4CLZf19FYOYrYoGbJPM72ksZqmMWiWtDaATU5cXcUf4Ic8rIN-ZJ2FmZx9wO9sP02EkhG-_sgfJZer3DpBaoPRQk8ezkNefRTm7FaukVSQlD2KbxlS3pzFG-r9jd0=15C626FB';
const AUTH       = 'Basic ' + Buffer.from(JIRA_EMAIL + ':' + JIRA_TOKEN).toString('base64');

const HISTORY_DIR   = __dirname;
const HISTORY_MAX   = 1000;
const HISTORY_PREFIX = 'qa_history_';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

// ── Helpers de historial ──────────────────────────────────────────────────────

function historyFiles() {
  return fs.readdirSync(HISTORY_DIR)
    .filter(f => f.startsWith(HISTORY_PREFIX) && f.endsWith('.json'))
    .sort();                         // qa_history_001.json, 002, ...
}

function readFile(filename) {
  try { return JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, filename), 'utf8')); }
  catch { return []; }
}

function activeFile() {
  const files = historyFiles();
  if (!files.length) return `${HISTORY_PREFIX}001.json`;
  const last = files[files.length - 1];
  const records = readFile(last);
  if (records.length >= HISTORY_MAX) {
    const num = parseInt(last.replace(HISTORY_PREFIX, '').replace('.json', '')) + 1;
    return `${HISTORY_PREFIX}${String(num).padStart(3, '0')}.json`;
  }
  return last;
}

function saveRecord(record) {
  const filename = activeFile();
  const filepath = path.join(HISTORY_DIR, filename);
  const records  = readFile(filename);
  records.push({ ...record, created_at: new Date().toISOString() });
  fs.writeFileSync(filepath, JSON.stringify(records, null, 2), 'utf8');
}

function allRecords() {
  return historyFiles()
    .flatMap(f => readFile(f))
    .reverse();                      // más reciente primero
}

// ── Servidor ──────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Atlassian-Token');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── GET /api/history ──
  if (req.method === 'GET' && parsed.pathname === '/api/history') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(allRecords()));
    return;
  }

  // ── POST /api/history ──
  if (req.method === 'POST' && parsed.pathname === '/api/history') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(body).toString());
        saveRecord(data);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── PROXY: /jira/* → Jira API ──
  if (parsed.pathname.startsWith('/jira/')) {
    const jiraPath = parsed.pathname.replace('/jira', '') + (parsed.search || '');
    console.log(`[PROXY] ${req.method} ${jiraPath}`);

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const bodyData = Buffer.concat(body);

      const headers = {
        'Authorization':      AUTH,
        'Accept':             'application/json',
        'X-Atlassian-Token':  req.headers['x-atlassian-token'] || '',
      };

      if (bodyData.length > 0) {
        headers['Content-Type']   = req.headers['content-type'] || 'application/json';
        headers['Content-Length'] = bodyData.length;
      }

      const options = {
        hostname: JIRA_HOST,
        port: 443,
        path: jiraPath,
        method: req.method,
        headers,
      };

      const proxyReq = https.request(options, proxyRes => {
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', err => {
        console.error('[PROXY ERROR]', err.message);
        res.writeHead(502); res.end(JSON.stringify({ error: err.message }));
      });

      if (bodyData.length > 0) proxyReq.write(bodyData);
      proxyReq.end();
    });
    return;
  }

  // ── Archivos estáticos ──
  let filePath = parsed.pathname === '/'        ? '/Qa_form.html'
               : parsed.pathname === '/history' ? '/history.html'
               : parsed.pathname;
  filePath = path.join(__dirname, filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Servidor QA corriendo');
  console.log(`  Abrir en el navegador: http://localhost:${PORT}`);
  console.log('  Ctrl+C para detener');
  console.log('');
});
