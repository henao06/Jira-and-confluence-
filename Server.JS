/**
 * Servidor local QA — proxy Jira/Confluence + servidor estático
 * Ejecutar: node Server.JS
 * Luego abrir: http://localhost:8080 (o el PORT del .env)
 * No requiere dependencias externas — solo Node.js
 * Toda la configuración de instancia vive en .env (ver .env.example)
 * Nuevo token se saca en https://id.atlassian.com/manage-profile/security/api-tokens
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

// Forzar IPv4 en todas las requests salientes: la red no tiene ruta IPv6 y Node
// intenta la IPv6 de Jira primero → ETIMEDOUT → 502. curl no falla porque hace
// Happy Eyeballs (IPv4+IPv6 en paralelo). family:4 evita el intento IPv6.
https.globalAgent.options.family = 4;

// Cargar .env sin dependencias externas
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const PORT        = parseInt(process.env.PORT, 10);
const JIRA_HOST   = process.env.JIRA_HOST;
const JIRA_EMAIL  = process.env.JIRA_EMAIL;
const JIRA_TOKEN  = process.env.JIRA_TOKEN;
const QA_PROJECT  = process.env.QA_PROJECT;   // identificador core: sin él ninguna página funciona

const ENV_ERROR = !PORT || !JIRA_HOST || !JIRA_EMAIL || !JIRA_TOKEN || !QA_PROJECT
  ? `Falta configurar el archivo .env<br><br>
     Variables requeridas:<br>
     ${!PORT       ? ' PORT<br>'       : ''}
     ${!JIRA_HOST  ? ' JIRA_HOST<br>'  : ''}
     ${!JIRA_EMAIL ? ' JIRA_EMAIL<br>' : ''}
     ${!JIRA_TOKEN ? ' JIRA_TOKEN<br>' : ''}
     ${!QA_PROJECT ? ' QA_PROJECT<br>' : ''}
     <br>Copiá <strong>.env.example</strong> como <strong>.env</strong> y completá los valores.`
  : null;

const AUTH = ENV_ERROR ? '' : 'Basic ' + Buffer.from(JIRA_EMAIL + ':' + JIRA_TOKEN).toString('base64');

// ── Config de instancia ────────────────────────────────────────────────────────
// TODO valor específico de una organización se define acá vía .env. El front-end lo
// consume por `/config.js` (window.APP_CONFIG) — no hay identificadores hardcodeados
// en HTML/JS. Los defaults son neutros; los valores reales van en tu .env (gitignore).
const CONFIG = {
  jira: {
    host:      JIRA_HOST,
    baseUrl:   JIRA_HOST ? `https://${JIRA_HOST}` : '',
    browseUrl: JIRA_HOST ? `https://${JIRA_HOST}/browse/` : '',
  },
  projects: {
    qa:   process.env.QA_PROJECT   || '',   // proyecto de test cases
    bug:  process.env.BUG_PROJECT  || '',   // proyecto de bugs
    tech: process.env.TECH_PROJECT || '',   // proyecto de tareas técnicas
  },
  fields: {
    reporterEmail: process.env.FIELD_REPORTER_EMAIL || '',                 // inyectado por el server (vacío = off)
    reporterName:  process.env.FIELD_REPORTER_NAME  || '',                 // inyectado por el server (vacío = off)
    category:      process.env.FIELD_CATEGORY       || '',                 // categoría de TC (vacío = off)
    epicLink:      process.env.FIELD_EPIC_LINK      || 'customfield_10014',// Epic Link (default estándar de Jira Cloud)
    bgDependency:  process.env.FIELD_BG_DEPENDENCY  || '',                 // dependencia bug↔TC (vacío = off)
  },
  epics: {
    verification: process.env.EPIC_VERIFICATION || '',  // epic padre de verificación de bugs
    activities:   process.env.EPIC_ACTIVITIES   || '',  // epic padre de actividades
  },
  workflow: {
    finalizeTransitionId:   process.env.TRANSITION_FINALIZE     || '',  // id de transición "Finalizada"
    bugUnderReviewStatusId: process.env.STATUS_BUG_UNDER_REVIEW || '',  // id de status "Under Review"
    versionPrefix:          process.env.VERSION_PREFIX          || 'v',  // prefijo de versiones de release
  },
  confluence: {
    historyPageId: process.env.CONFLUENCE_HISTORY_PAGE_ID || '',  // página de historial de releases
    space:         process.env.CONFLUENCE_SPACE           || '',  // space key de Confluence
  },
  branding: {
    orgName: process.env.ORG_NAME || 'QA Suite',        // nombre visible de la organización
    appName: process.env.APP_NAME || 'QA Automation',   // nombre visible de la app
  },
};

let myAccountId        = null;
let myDisplayName      = null;

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

  // ── Config de instancia para el front-end (window.APP_CONFIG) ──────────────
  if (parsed.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('window.APP_CONFIG = ' + JSON.stringify(CONFIG) + ';\n');
    return;
  }

  // ── Diagnóstico de campos (categoría del proyecto QA) ──────────────────────
  if (parsed.pathname === '/debug/campos-qaa') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    (async () => {
      try {
        const qaProject   = CONFIG.projects.qa;
        const categoryFld = CONFIG.fields.category;
        if (!qaProject || !categoryFld) {
          res.end(JSON.stringify({ error: 'Configurá QA_PROJECT y FIELD_CATEGORY en el .env para usar este diagnóstico' }));
          return;
        }
        // Buscar cualquier issue del proyecto QA y llamar editmeta
        const search = await jiraPost('/rest/api/3/search/jql', {
          jql: `project = ${qaProject} ORDER BY created DESC`,
          maxResults: 5,
          fields: ['summary', 'issuetype'],
        });
        const issues = search.issues || [];
        const resultados = [];
        for (const issue of issues) {
          try {
            const meta  = await jiraGet(`/rest/api/3/issue/${issue.key}/editmeta`);
            const campo = meta.fields?.[categoryFld];
            resultados.push({ key: issue.key, tipo: issue.fields?.issuetype?.name, campoCategoria: campo });
            if (campo?.allowedValues?.length) break;
          } catch(e) { resultados.push({ key: issue.key, error: e.message }); }
        }
        // Leer el campo directamente de los issues existentes
        const valoresReales = [];
        for (const issue of issues) {
          try {
            const full  = await jiraGet(`/rest/api/3/issue/${issue.key}?fields=${categoryFld}`);
            const valor = full.fields?.[categoryFld];
            valoresReales.push({ key: issue.key, [categoryFld]: valor });
          } catch(e) { valoresReales.push({ key: issue.key, error: e.message }); }
        }

        res.end(JSON.stringify({ resultados, valoresReales }, null, 2));
      } catch(e) {
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
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
            const fEmail = CONFIG.fields.reporterEmail;
            const fName  = CONFIG.fields.reporterName;
            if (fEmail && !payload.fields[fEmail]) payload.fields[fEmail] = JIRA_EMAIL;
            if (fName  && !payload.fields[fName])  payload.fields[fName]  = myDisplayName || JIRA_EMAIL;
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
               : parsed.pathname === '/actividades'       ? '/actividades.html'
               : parsed.pathname;
  filePath = path.join(__dirname, filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': mime };
    if (ext === '.js') headers['Cache-Control'] = 'no-cache, must-revalidate';
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Servidor QA corriendo');
  console.log(`  http://localhost:${PORT}`);
  console.log('');
  fetchMyself();
});
