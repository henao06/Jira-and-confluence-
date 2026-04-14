/**
 * Servidor local QA — Hybred
 * Ejecutar: node server.js
 * Luego abrir: http://localhost:3000
 * No requiere instalar nada — solo Node.js
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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);

  // ── CORS headers para todas las respuestas ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Atlassian-Token');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

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

      // Solo poner Content-Type si hay body
      if (bodyData.length > 0) {
        headers['Content-Type'] = req.headers['content-type'] || 'application/json';
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

  // ── ARCHIVOS ESTÁTICOS ──
  let filePath = parsed.pathname === '/' ? '/Qa_form.html' : parsed.pathname;
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
  console.log('  ✅ Servidor QA corriendo');
  console.log(`  📋 Abrir en el navegador: http://localhost:${PORT}`);
  console.log('  🔄 Ctrl+C para detener');
  console.log('');
});