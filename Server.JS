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
let dependenciaDefault = null;

// ── Helpers Jira ──────────────────────────────────────────────────────────────

function jiraGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: JIRA_HOST, port: 443, path: apiPath, method: 'GET',
        headers: { 'Authorization': AUTH, 'Accept': 'application/json' } },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode, body: parsed }));
            else resolve(parsed);
          } catch(e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function jiraPost(apiPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request(
      { hostname: JIRA_HOST, port: 443, path: apiPath, method: 'POST',
        headers: { 'Authorization': AUTH, 'Accept': 'application/json',
                   'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode, body: parsed }));
            else resolve(parsed);
          } catch(e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── Startup: resolver accountId y dependenciaDefault ─────────────────────────

function fetchMyself() {
  if (ENV_ERROR) return Promise.resolve();
  return jiraGet('/rest/api/3/myself')
    .then(me => {
      if (me.accountId) {
        myAccountId   = me.accountId;
        myDisplayName = me.displayName || JIRA_EMAIL;
        console.log(`  accountId    : ${myAccountId} (${myDisplayName})`);
      } else {
        console.warn('[MYSELF] respuesta sin accountId');
      }
    })
    .catch(e => console.warn('[MYSELF] error:', e.message));
}

async function fetchDependenciaDefault() {
  if (ENV_ERROR) return;

  // Override manual desde .env — tiene prioridad sobre todo
  if (process.env.DEPENDENCIA_JSON) {
    try {
      dependenciaDefault = JSON.parse(process.env.DEPENDENCIA_JSON);
      console.log(`  dependenciaDefault (desde .env): ${JSON.stringify(dependenciaDefault)}`);
      return;
    } catch(e) { console.warn('[DEPENDENCIA] DEPENDENCIA_JSON inválido en .env:', e.message); }
  }

  // Diagnóstico: tipo del campo (para saber qué formato de valor poner)
  try {
    const allFields = await jiraGet('/rest/api/3/field');
    const def = allFields.find(f => f.id === 'customfield_10370');
    if (def) {
      console.log(`[DEPENDENCIA] tipo del campo "${def.name}":`, JSON.stringify({
        type:   def.schema?.type,
        items:  def.schema?.items,
        custom: def.schema?.custom,
      }));
    } else {
      console.warn('[DEPENDENCIA] customfield_10370 no encontrado en /rest/api/3/field');
    }
  } catch(e) { console.warn('[DEPENDENCIA] no se pudo obtener definición del campo:', e.message); }

  // 1. Buscar en issues reales del proyecto BG (con el campo seteado)
  try {
    const res = await jiraPost('/rest/api/3/search/jql', {
      jql: 'project = BG AND cf[10370] is not EMPTY ORDER BY created DESC',
      maxResults: 1,
      fields: ['customfield_10370'],
    });
    console.log('[DEPENDENCIA] issues BG con campo seteado:', res.total);
    if (res.issues?.[0]?.fields?.customfield_10370) {
      dependenciaDefault = res.issues[0].fields.customfield_10370;
      console.log(`  dependenciaDefault: ${JSON.stringify(dependenciaDefault)}`);
      return;
    }
  } catch(e) { console.warn('[DEPENDENCIA] búsqueda BG falló:', e.message); }

  // 2. Buscar en issues reales del proyecto QAA
  try {
    const res = await jiraPost('/rest/api/3/search/jql', {
      jql: 'project = QAA AND cf[10370] is not EMPTY ORDER BY created DESC',
      maxResults: 1,
      fields: ['customfield_10370'],
    });
    console.log('[DEPENDENCIA] issues QAA con campo seteado:', res.total);
    if (res.issues?.[0]?.fields?.customfield_10370) {
      dependenciaDefault = res.issues[0].fields.customfield_10370;
      console.log(`  dependenciaDefault: ${JSON.stringify(dependenciaDefault)}`);
      return;
    }
  } catch(e) { console.warn('[DEPENDENCIA] búsqueda QAA falló:', e.message); }

  // 3. allowedValues desde createmeta
  try {
    const types = await jiraGet('/rest/api/3/issue/createmeta/BG/issuetypes');
    const list  = types.issueTypes || types.values || [];
    const bug   = list.find(t => t.name === 'Bug');
    if (bug) {
      const meta   = await jiraGet(`/rest/api/3/issue/createmeta/BG/issuetypes/${bug.id}`);
      const values = meta.values || [];
      const field  = values.find(v => v.fieldId === 'customfield_10370');
      console.log('[DEPENDENCIA] createmeta field:', JSON.stringify(field));
      if (field?.allowedValues?.length) {
        dependenciaDefault = field.allowedValues[0];
        console.log(`  dependenciaDefault: ${JSON.stringify(dependenciaDefault)}`);
        return;
      }
    }
  } catch(e) { console.warn('[DEPENDENCIA] createmeta falló:', e.message); }

  console.warn(`
  [DEPENDENCIA] ❌ no se pudo resolver customfield_10370 automáticamente.
  Solución: agregá en tu .env:
    DEPENDENCIA_JSON=<valor>
  El tipo del campo está en el log "[DEPENDENCIA] tipo del campo" arriba.
  Ejemplo para campo tipo "option":  DEPENDENCIA_JSON={"id":"10001"}
  Ejemplo para campo tipo "string":  DEPENDENCIA_JSON="Mi valor"
  `);
}

// ── MIME types ────────────────────────────────────────────────────────────────

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

  // ── PROXY: /jira/* → Jira API ─────────────────────────────────────────────
  if (parsed.pathname.startsWith('/jira/')) {
    const jiraPath = parsed.pathname.replace('/jira', '') + (parsed.search || '');

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      let bodyData = Buffer.concat(body);

      // Inyectar campos requeridos en creación de issues
      if (req.method === 'POST' && jiraPath === '/rest/api/3/issue' && bodyData.length > 0) {
        try {
          const payload = JSON.parse(bodyData.toString());
          if (payload.fields) {
            if (!payload.fields.customfield_10271) payload.fields.customfield_10271 = JIRA_EMAIL;
            if (!payload.fields.customfield_10337) payload.fields.customfield_10337 = myDisplayName || JIRA_EMAIL;
            if (!payload.fields.customfield_10370 && dependenciaDefault) payload.fields.customfield_10370 = dependenciaDefault;
            bodyData = Buffer.from(JSON.stringify(payload));

            const proj = payload.fields.project?.key || '?';
            const type = payload.fields.issuetype?.name || '?';
            console.log(`\n→ CREATE ${proj}/${type}`);
            console.log('  payload:', JSON.stringify(payload, null, 2));
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

      function doRequest(hostname, apiPath, method, headers, bodyBuf, depth) {
        if (depth > 5) { res.writeHead(508); res.end('Too many redirects'); return; }

        const proxyReq = https.request({ hostname, port: 443, path: apiPath, method, headers }, proxyRes => {
          const status = proxyRes.statusCode;

          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = proxyRes.headers['location'];
            proxyRes.resume();
            if (!location) { res.writeHead(502); res.end('Redirect sin Location'); return; }
            try {
              const u = new URL(location);
              const rHeaders = u.hostname === JIRA_HOST
                ? { 'Authorization': AUTH, 'Accept': '*/*' }
                : { 'Accept': '*/*' };
              doRequest(u.hostname, u.pathname + (u.search || ''), 'GET', rHeaders, null, depth + 1);
            } catch { res.writeHead(502); res.end('Location inválida'); }
            return;
          }

          const ct = proxyRes.headers['content-type'] || 'application/octet-stream';
          res.writeHead(status, { 'Content-Type': ct, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });

          // Capturar y loggear respuesta para métodos de escritura o errores
          const capture = status >= 400 || (method !== 'GET' && method !== 'OPTIONS');
          if (capture) {
            let raw = '';
            proxyRes.on('data', c => { raw += c; res.write(c); });
            proxyRes.on('end', () => {
              if (status >= 400) {
                try {
                  const parsed = JSON.parse(raw);
                  const msgs   = [...(parsed.errorMessages || [])];
                  Object.values(parsed.errors || {}).forEach(v => { if (!msgs.includes(v)) msgs.push(v); });
                  console.error(`\n  ╔══ ERROR ${status} ══ ${method} ${apiPath}`);
                  msgs.forEach(m => console.error(`  ║  ✗ ${m}`));
                  console.error(`  ║  raw: ${raw}`);
                  console.error(`  ╚${'═'.repeat(60)}\n`);
                } catch { console.error(`[ERROR ${status}]`, raw); }
              } else {
                console.log(`← ${status} ${method} ${apiPath}`);
                console.log('  response:', raw.slice(0, 500));
              }
              res.end();
            });
          } else {
            proxyRes.pipe(res);
          }
        });

        proxyReq.on('error', err => {
          console.error('[PROXY ERROR]', err.message);
          if (!res.headersSent) { res.writeHead(502); res.end(JSON.stringify({ error: err.message })); }
        });

        if (bodyBuf && bodyBuf.length > 0) proxyReq.write(bodyBuf);
        proxyReq.end();
      }

      doRequest(JIRA_HOST, jiraPath, req.method, baseHeaders, bodyData, 0);
    });
    return;
  }

  // ── PROXY: /wiki/* → Confluence API ──────────────────────────────────────
  if (req.url.startsWith('/wiki/')) {
    const wikiPath = req.url;
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const bodyData = Buffer.concat(body);
      const headers = { 'Authorization': AUTH, 'Accept': 'application/json' };
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

  // ── Archivos estáticos ────────────────────────────────────────────────────
  let filePath = parsed.pathname === '/'                  ? '/Qa_form.html'
               : parsed.pathname === '/history'           ? '/history.html'
               : parsed.pathname === '/jira-editor'       ? '/jira_editor.html'
               : parsed.pathname === '/bg-verificacion'   ? '/bg_verificacion.html'
               : parsed.pathname;
  filePath = path.join(__dirname, filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const mime = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Servidor QA corriendo');
  console.log(`  http://localhost:${PORT}`);
  console.log('');
  fetchMyself().then(() => fetchDependenciaDefault());
});
