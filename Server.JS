/**
 * Servidor local QA — Hybred
 * Ejecutar: node Server.JS
 * Luego abrir: http://localhost:8080
 * No requiere dependencias externas — solo Node.js
 * Nuevo token se saca en https://id.atlassian.com/manage-profile/security/api-tokens
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');


// Cargar .env sin dependencias externas
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const PORT       = parseInt(process.env.PORT, 10);
const JIRA_HOST  = process.env.JIRA_HOST;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_TOKEN = process.env.JIRA_TOKEN;

const ENV_ERROR = !PORT || !JIRA_HOST || !JIRA_EMAIL || !JIRA_TOKEN
  ? `Falta configurar el archivo .env<br><br>
     Variables requeridas:<br>
     ${!PORT       ? ' PORT<br>'       : ''}
     ${!JIRA_HOST  ? ' JIRA_HOST<br>'  : ''}
     ${!JIRA_EMAIL ? ' JIRA_EMAIL<br>' : ''}
     ${!JIRA_TOKEN ? ' JIRA_TOKEN<br>' : ''}
     <br>Copiá <strong>.env.example</strong> como <strong>.env</strong> y completá los valores.`
  : null;

const AUTH = ENV_ERROR ? '' : 'Basic ' + Buffer.from(JIRA_EMAIL + ':' + JIRA_TOKEN).toString('base64');

let myAccountId        = null;
let myDisplayName      = null;
let dependenciaDefault = null; // primer id válido de customfield_10370

function fetchMyself() {
  if (ENV_ERROR) return Promise.resolve();
  return new Promise(resolve => {
    const req = https.request(
      { hostname: JIRA_HOST, port: 443, path: '/rest/api/3/myself', method: 'GET',
        headers: { 'Authorization': AUTH, 'Accept': 'application/json' } },
      res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const me = JSON.parse(data);
            if (me.accountId) {
              myAccountId   = me.accountId;
              myDisplayName = me.displayName || JIRA_EMAIL;
              console.log(`  accountId resuelto: ${myAccountId}`);
            } else console.warn('[MYSELF] respuesta sin accountId:', data.slice(0, 200));
          } catch(e) { console.warn('[MYSELF] error parseando respuesta:', e.message); }
          resolve();
        });
      }
    );
    req.on('error', e => { console.warn('[MYSELF] error de red:', e.message); resolve(); });
    req.end();
  });
}

function jiraGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: JIRA_HOST, port: 443, path, method: 'GET',
        headers: { 'Authorization': AUTH, 'Accept': 'application/json' } },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function fetchFieldDefaults() {
  if (ENV_ERROR) return;
  try {
    // Buscar una issue QAA existente que tenga el campo seteado
    const search = await jiraGet(
      '/rest/api/3/search?jql=project%3DQAA%20ORDER%20BY%20created%20DESC&maxResults=3&fields=customfield_10370,issuetype,summary'
    );
    const issues = search?.issues || [];
    console.log(`[FIELDS] issues encontradas: ${issues.length}`);
    for (const issue of issues) {
      const val = issue.fields?.customfield_10370;
      console.log(`  ${issue.key} (${issue.fields?.issuetype?.name}): customfield_10370 =`, JSON.stringify(val));
      if (val && val.id) {
        dependenciaDefault = { id: val.id };
        console.log(`  → usando: "${val.value}" (id ${val.id})`);
        return;
      }
    }
    console.warn('[FIELDS] ninguna issue con customfield_10370 seteado');
  } catch(e) {
    console.warn('[FIELDS] error resolviendo customfield_10370:', e.message);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

// ── Servidor ──────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Atlassian-Token');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (ENV_ERROR) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error de configuración</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#f1f5f9}
      .box{background:#1e293b;border:1px solid #ef4444;border-radius:12px;padding:32px;max-width:480px;line-height:1.7}
      h2{color:#ef4444;margin-top:0}code{background:#0f172a;padding:2px 6px;border-radius:4px}</style></head>
      <body><div class="box"><h2>⚠️ Error de configuración</h2><p>${ENV_ERROR}</p></div></body></html>`);
    return;
  }

  // ── PROXY: /jira/* → Jira API (sigue redirects server-side) ──
  if (parsed.pathname.startsWith('/jira/')) {
    const jiraPath = parsed.pathname.replace('/jira', '') + (parsed.search || '');
    console.log(`[PROXY] ${req.method} ${jiraPath}`);

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      let bodyData = Buffer.concat(body);

      // Inyectar campos requeridos en creación de issues (solo cuando viene del formulario principal)
      if (req.method === 'POST' && jiraPath === '/rest/api/3/issue' && bodyData.length > 0) {
        try {
          const payload = JSON.parse(bodyData.toString());
          if (payload.fields) {
            if (!payload.fields.customfield_10271) payload.fields.customfield_10271 = JIRA_EMAIL;
            if (!payload.fields.customfield_10337) payload.fields.customfield_10337 = myDisplayName || JIRA_EMAIL;
            if (!payload.fields.customfield_10370 && dependenciaDefault) payload.fields.customfield_10370 = dependenciaDefault;
            console.log('[INJECT] customfield_10370 enviado:', JSON.stringify(payload.fields.customfield_10370));
            console.log('[INJECT] dependenciaDefault al momento de inyectar:', JSON.stringify(dependenciaDefault));
            bodyData = Buffer.from(JSON.stringify(payload));
          }
        } catch(e) { console.warn('[INJECT] error parseando body:', e.message); }
      }

      const baseHeaders = {
        'Authorization':      AUTH,
        'Accept':             '*/*',
        'X-Atlassian-Token':  req.headers['x-atlassian-token'] || '',
      };
      if (bodyData.length > 0) {
        baseHeaders['Content-Type']   = req.headers['content-type'] || 'application/json';
        baseHeaders['Content-Length'] = bodyData.length;
      }

      function doRequest(hostname, path, method, headers, body, depth) {
        if (depth > 5) { res.writeHead(508); res.end('Too many redirects'); return; }

        const options = { hostname, port: 443, path, method, headers };
        const proxyReq = https.request(options, proxyRes => {
          const status = proxyRes.statusCode;

          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = proxyRes.headers['location'];
            proxyRes.resume();
            if (!location) { res.writeHead(502); res.end('Redirect sin Location'); return; }
            try {
              const u = new URL(location);
              const redirectHeaders = u.hostname === JIRA_HOST
                ? { 'Authorization': AUTH, 'Accept': '*/*' }
                : { 'Accept': '*/*' };
              doRequest(u.hostname, u.pathname + (u.search || ''), 'GET',
                redirectHeaders, null, depth + 1);
            } catch {
              res.writeHead(502); res.end('Location inválida');
            }
            return;
          }

          const ct = proxyRes.headers['content-type'] || 'application/octet-stream';
          res.writeHead(status, { 'Content-Type': ct, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });

          // Log completo de errores Jira para debugging
          if (status >= 400 && method === 'POST' && path.includes('/issue')) {
            let raw = '';
            proxyRes.on('data', c => { raw += c; res.write(c); });
            proxyRes.on('end', () => { console.log(`[JIRA ERROR ${status}]`, raw); res.end(); });
          } else {
            proxyRes.pipe(res);
          }
        });

        proxyReq.on('error', err => {
          console.error('[PROXY ERROR]', err.message);
          if (!res.headersSent) { res.writeHead(502); res.end(JSON.stringify({ error: err.message })); }
        });

        if (body && body.length > 0) proxyReq.write(body);
        proxyReq.end();
      }

      doRequest(JIRA_HOST, jiraPath, req.method, baseHeaders, bodyData, 0);
    });
    return;
  }

  // ── PROXY: /wiki/* → Confluence API ──
  if (req.url.startsWith('/wiki/')) {
    const wikiPath = req.url;
    console.log(`[WIKI] ${req.method} ${wikiPath}`);

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const bodyData = Buffer.concat(body);
      const headers = {
        'Authorization': AUTH,
        'Accept':        'application/json',
      };
      if (bodyData.length > 0) {
        headers['Content-Type']   = req.headers['content-type'] || 'application/json';
        headers['Content-Length'] = bodyData.length;
      }
      const proxyReq = https.request({ hostname: JIRA_HOST, port: 443, path: wikiPath, method: req.method, headers }, proxyRes => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': proxyRes.headers['content-type'] || 'application/json', 'Access-Control-Allow-Origin': '*' });
        proxyRes.pipe(res);
      });
      proxyReq.on('error', err => { res.writeHead(502); res.end(JSON.stringify({ error: err.message })); });
      if (bodyData.length > 0) proxyReq.write(bodyData);
      proxyReq.end();
    });
    return;
  }

  // ── Archivos estáticos ──
  let filePath = parsed.pathname === '/'                  ? '/Qa_form.html'
               : parsed.pathname === '/history'           ? '/history.html'
               : parsed.pathname === '/jira-editor'       ? '/jira_editor.html'
               : parsed.pathname === '/bg-verificacion'   ? '/bg_verificacion.html'
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
  fetchMyself();
  fetchFieldDefaults();
});
