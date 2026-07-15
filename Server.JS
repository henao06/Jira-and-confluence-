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

// Ruta del config estructural generado por el wizard (gitignoreado, SIN secretos)
const CONFIG_PATH = path.join(__dirname, 'qa-config.json');

// ── Secretos de conexión (mutables: el wizard los reescribe sin reiniciar) ──────
// Solo esto vive en .env. La config estructural (tableros, campos, epics, branding)
// vive en qa-config.json. El token NUNCA se serializa a /config.js.
let PORT       = parseInt(process.env.PORT, 10);
let JIRA_HOST  = process.env.JIRA_HOST;
let JIRA_EMAIL = process.env.JIRA_EMAIL;
let JIRA_TOKEN = process.env.JIRA_TOKEN;
let AUTH       = buildAuth();

function buildAuth() {
  return (JIRA_EMAIL && JIRA_TOKEN)
    ? 'Basic ' + Buffer.from(JIRA_EMAIL + ':' + JIRA_TOKEN).toString('base64')
    : '';
}

// Devuelve la lista de secretos faltantes (vacía = conexión configurada).
function secretsMissing() {
  const missing = [];
  if (!PORT)       missing.push('PORT');
  if (!JIRA_HOST)  missing.push('JIRA_HOST');
  if (!JIRA_EMAIL) missing.push('JIRA_EMAIL');
  if (!JIRA_TOKEN) missing.push('JIRA_TOKEN');
  return missing;
}

// ── Capa de config estructural (qa-config.json → window.APP_CONFIG) ──────────────
// Precedencia: qa-config.json válido → fallback legacy por .env → defaults neutros.
// Así las instalaciones viejas (todo por .env) siguen andando y las nuevas usan el wizard.

// Lee y parsea qa-config.json. null = no existe; {__parseError} = JSON inválido (no lanza).
function loadRawConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error('[CONFIG] qa-config.json inválido:', e.message);
    return { __parseError: e.message };
  }
}

// Valida la forma del config. Devuelve [{path, message}] (vacío = válido). Cero deps.
function validateConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [{ path: '(root)', message: 'config vacía o no es un objeto' }];
  }
  if (raw.__parseError) return [{ path: '(root)', message: 'JSON inválido: ' + raw.__parseError }];
  const problems = [];
  if (raw.version !== 1) problems.push({ path: 'version', message: 'version debe ser 1' });

  const boards = raw.boards || {};
  const qa = boards.qa;
  if (!qa || !Array.isArray(qa.items) || qa.items.length === 0) {
    problems.push({ path: 'boards.qa.items', message: 'se requiere al menos un tablero QA' });
  } else {
    const active = qa.items.find(b => b && b.id === qa.activeBoardId) || qa.items[0];
    if (!active || !active.projectKey) {
      problems.push({ path: 'boards.qa.items[0].projectKey', message: 'projectKey requerido en el tablero QA activo' });
    }
  }
  // Integridad de cada tipo presente: ids únicos y activeBoardId resoluble.
  for (const type of ['qa', 'bug', 'tech']) {
    const grp = boards[type];
    if (!grp) continue;
    if (!Array.isArray(grp.items)) { problems.push({ path: `boards.${type}.items`, message: 'items debe ser un array' }); continue; }
    const ids = new Set();
    grp.items.forEach((b, i) => {
      if (!b || typeof b !== 'object') { problems.push({ path: `boards.${type}.items[${i}]`, message: 'tablero inválido' }); return; }
      if (!b.id) problems.push({ path: `boards.${type}.items[${i}].id`, message: 'id requerido' });
      else if (ids.has(b.id)) problems.push({ path: `boards.${type}.items[${i}].id`, message: 'id duplicado' });
      else ids.add(b.id);
    });
    if (grp.activeBoardId && grp.items.length && !grp.items.some(b => b && b.id === grp.activeBoardId)) {
      problems.push({ path: `boards.${type}.activeBoardId`, message: 'activeBoardId no coincide con ningún tablero' });
    }
  }
  return problems;
}

// Devuelve el tablero activo de un grupo (o el primero, o null).
function activeBoard(grp) {
  if (!grp || !Array.isArray(grp.items) || !grp.items.length) return null;
  return grp.items.find(b => b && b.id === grp.activeBoardId) || grp.items[0];
}

// Metadata de tableros para el selector del front (id/nombre/projectKey; SIN secretos ni epics).
function boardMeta(grp) {
  if (!grp || !Array.isArray(grp.items)) return { activeBoardId: '', items: [] };
  const items = grp.items.filter(b => b && b.id)
    .map(b => ({ id: b.id, name: b.name || b.projectKey || b.id, projectKey: b.projectKey || '' }));
  return { activeBoardId: (activeBoard(grp) || {}).id || '', items };
}

// Textos de la interfaz. Los defaults son GENÉRICOS (no atados a ninguna organización);
// cada instancia los pisa desde qa-config.json → "labels". Así "Finalizar TC" no queda
// quemado: quien baje la app ve el default y lo cambia por el nombre de SU tablero.
const LABEL_DEFAULTS = {
  reportBug:        'Reportar como bug',
  finalizeBug:      'Finalizar bug',
  finalizeTestCase: 'Finalizar caso',
  requiresConfig:   'Requiere configuración',
};

function resolveLabels(src) {
  const L = (src && src.labels) || {};
  const out = {};
  for (const k in LABEL_DEFAULTS) {
    out[k] = (typeof L[k] === 'string' && L[k].trim()) ? L[k].trim() : LABEL_DEFAULTS[k];
  }
  return out;
}

// Resuelve el config estructural al shape plano que consume el front (APP_CONFIG).
// NUNCA incluye email/token/AUTH.
function resolveConfig(raw) {
  const boards = raw.boards || {};
  const qa   = activeBoard(boards.qa)   || {};
  const bug  = activeBoard(boards.bug)  || {};
  const tech = activeBoard(boards.tech) || {};
  const f = raw.fields || {}, w = raw.workflow || {}, c = raw.confluence || {}, b = raw.branding || {};
  const qaEpics = qa.epics || {};
  const confOn = !!c.enabled;
  return {
    jira: {
      host:      JIRA_HOST || '',
      baseUrl:   JIRA_HOST ? `https://${JIRA_HOST}` : '',
      browseUrl: JIRA_HOST ? `https://${JIRA_HOST}/browse/` : '',
    },
    projects: { qa: qa.projectKey || '', bug: bug.projectKey || '', tech: tech.projectKey || '' },
    fields: {
      reporterEmail: f.reporterEmail || '',
      reporterName:  f.reporterName  || '',
      category:      f.category      || '',
      epicLink:      f.epicLink      || 'customfield_10014',
      bgDependency:  f.bgDependency  || '',
    },
    epics: { verification: qaEpics.verification || '', activities: qaEpics.activities || '' },
    workflow: {
      finalizeTransitionId:   w.finalizeTransitionId   || '',
      bugUnderReviewStatusId: w.bugUnderReviewStatusId || '',
      versionPrefix:          w.versionPrefix          || 'v',
    },
    confluence: {
      historyPageId: confOn ? (c.historyPageId || '') : '',
      space:         confOn ? (c.space || '')         : '',
    },
    branding: { orgName: b.orgName || 'QA Suite', appName: b.appName || 'QA Automation' },
    labels: resolveLabels(raw),
    // Metadata de tableros para el selector (Fase 2). Solo nombres/ids, sin secretos.
    boards: {
      qa:   boardMeta(boards.qa),
      bug:  boardMeta(boards.bug),
      tech: boardMeta(boards.tech),
    },
  };
}

// Cache por mtime: re-lee qa-config.json solo si cambió (así el wizard se refleja sin
// reiniciar). Devuelve { config, setupRequired, problems }.
let _cfgCache = { mtimeMs: null, config: null, setupRequired: true, problems: [] };

function getConfig() {
  let mtimeMs = 0;
  try { if (fs.existsSync(CONFIG_PATH)) mtimeMs = fs.statSync(CONFIG_PATH).mtimeMs; } catch {}
  if (_cfgCache.config && mtimeMs === _cfgCache.mtimeMs) return _cfgCache;

  const raw = loadRawConfig();
  let config, setupRequired, problems;
  if (raw && !raw.__parseError) {
    problems = validateConfig(raw);
    if (problems.length === 0) {
      // qa-config.json válido → ÚNICA fuente de config estructural.
      config = resolveConfig(raw); setupRequired = false;
    } else {
      // JSON presente pero inválido → wizard, señalando los problemas.
      config = resolveConfig({}); setupRequired = true;
    }
  } else {
    // Sin JSON (o ilegible) → wizard. El JSON es la fuente ÚNICA: NO hay fallback por .env.
    // (Las variables estructurales viejas del .env ya no se usan; los secretos siguen en .env.)
    problems = (raw && raw.__parseError)
      ? [{ path: '(root)', message: 'JSON inválido: ' + raw.__parseError }]
      : [{ path: 'qa-config.json', message: 'falta qa-config.json — configuralo desde el wizard' }];
    config = resolveConfig({});
    setupRequired = true;
  }
  _cfgCache = { mtimeMs, config, setupRequired, problems };
  return _cfgCache;
}

// Upsert de los secretos en .env preservando líneas/comentarios; actualiza in-memory.
// Si el token viene vacío, se conserva el existente. Devuelve { portChanged }.
function applySecretsToEnv(secrets) {
  const setLine = {};
  for (const k of ['JIRA_HOST', 'JIRA_EMAIL', 'JIRA_TOKEN', 'PORT']) {
    let v = secrets[k];
    if (k === 'JIRA_TOKEN' && (v === undefined || v === null || v === '')) continue; // conservar token
    if (v === undefined || v === null) continue;
    setLine[k] = String(v).trim();
  }
  let text = '';
  try { if (fs.existsSync(envPath)) text = fs.readFileSync(envPath, 'utf8'); } catch {}
  const seen = new Set();
  const out = text.split('\n').map(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && Object.prototype.hasOwnProperty.call(setLine, m[1])) { seen.add(m[1]); return `${m[1]}=${setLine[m[1]]}`; }
    return line;
  });
  for (const k of Object.keys(setLine)) if (!seen.has(k)) out.push(`${k}=${setLine[k]}`);
  fs.writeFileSync(envPath, out.join('\n'));

  const oldPort = PORT;
  if (setLine.JIRA_HOST  !== undefined) { JIRA_HOST  = setLine.JIRA_HOST;  process.env.JIRA_HOST  = JIRA_HOST; }
  if (setLine.JIRA_EMAIL !== undefined) { JIRA_EMAIL = setLine.JIRA_EMAIL; process.env.JIRA_EMAIL = JIRA_EMAIL; }
  if (setLine.JIRA_TOKEN !== undefined) { JIRA_TOKEN = setLine.JIRA_TOKEN; process.env.JIRA_TOKEN = JIRA_TOKEN; }
  if (setLine.PORT       !== undefined) { PORT = parseInt(setLine.PORT, 10); process.env.PORT = setLine.PORT; }
  AUTH = buildAuth();
  return { portChanged: setLine.PORT !== undefined && parseInt(setLine.PORT, 10) !== oldPort };
}

// Respuesta JSON breve reutilizable.
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

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
  if (secretsMissing().length) return Promise.resolve();
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

  // ── Config de instancia para el front-end (window.APP_CONFIG) ──────────────
  // El token NUNCA se incluye (getConfig sólo expone estructura). no-store para que
  // lo que guarda el wizard se refleje en el próximo reload sin reiniciar.
  if (parsed.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('window.APP_CONFIG = ' + JSON.stringify(getConfig().config) + ';\n');
    return;
  }

  // ── Estado del setup: qué falta para arrancar (lo consume el wizard) ───────
  if (parsed.pathname === '/setup/status') {
    const cfg     = getConfig();
    const missing = secretsMissing();
    sendJson(res, 200, {
      needSetup:      missing.length > 0 || cfg.setupRequired,
      missingSecrets: missing,
      problems:       cfg.problems,
      hasSecrets:     missing.length === 0,
    });
    return;
  }

  // ── Guardar config del wizard: valida → escribe qa-config.json + upsert .env ─
  if (req.method === 'POST' && parsed.pathname === '/setup/save') {
    let body = [];
    req.on('data', c => body.push(c));
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(Buffer.concat(body).toString()); }
      catch (e) { console.error('[SETUP] body inválido:', e.message); return sendJson(res, 400, { ok: false, problems: [{ path: 'body', message: 'JSON inválido' }] }); }

      const config  = payload.config  || {};
      const secrets = payload.secrets || {};

      const problems = validateConfig(config);
      if (problems.length) return sendJson(res, 422, { ok: false, problems });   // no escribe si es inválido

      try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n'); }
      catch (e) { console.error('[SETUP] no se pudo escribir qa-config.json:', e.message); return sendJson(res, 500, { ok: false, error: 'No se pudo escribir qa-config.json: ' + e.message }); }

      let portChanged = false;
      try { portChanged = applySecretsToEnv(secrets).portChanged; }
      catch (e) { console.error('[SETUP] no se pudo escribir .env:', e.message); return sendJson(res, 500, { ok: false, error: 'No se pudo escribir .env: ' + e.message }); }

      _cfgCache.mtimeMs = null;  // fuerza re-lectura en el próximo getConfig
      console.log('[SETUP] configuración guardada' + (portChanged ? ' (PORT cambió → requiere reinicio)' : ''));
      sendJson(res, 200, { ok: true, needsRestart: portChanged });   // nunca devolvemos el token
    });
    return;
  }

  // ── Guardar SOLO los secretos de conexión (portón de arranque /connect) ─────
  // No toca qa-config.json ni valida config: la conexión es un secreto, no parte
  // de la personalización. Reemplaza al Paso 1 del wizard.
  if (req.method === 'POST' && parsed.pathname === '/setup/secrets') {
    let body = [];
    req.on('data', c => body.push(c));
    req.on('end', () => {
      let secrets;
      try { secrets = JSON.parse(Buffer.concat(body).toString()); }
      catch { return sendJson(res, 400, { ok: false, message: 'JSON inválido' }); }
      let portChanged = false;
      try { portChanged = applySecretsToEnv(secrets).portChanged; }
      catch (e) { console.error('[SETUP] no se pudo escribir .env:', e.message); return sendJson(res, 500, { ok: false, error: 'No se pudo escribir .env: ' + e.message }); }
      const missing = secretsMissing();
      console.log('[SETUP] secretos de conexión guardados' + (portChanged ? ' (PORT cambió → requiere reinicio)' : ''));
      sendJson(res, 200, { ok: true, needsRestart: portChanged, missingSecrets: missing });   // nunca devolvemos el token
    });
    return;
  }

  // ── Probar conexión con credenciales tipeadas (aún sin guardar) ────────────
  if (req.method === 'POST' && parsed.pathname === '/setup/test-connection') {
    let body = [];
    req.on('data', c => body.push(c));
    req.on('end', () => {
      let creds;
      try { creds = JSON.parse(Buffer.concat(body).toString()); }
      catch { return sendJson(res, 400, { ok: false, message: 'JSON inválido' }); }
      const host  = (creds.JIRA_HOST  || '').trim();
      const email = (creds.JIRA_EMAIL || '').trim();
      const token = (creds.JIRA_TOKEN || '').trim();
      if (!host || !email || !token) return sendJson(res, 200, { ok: false, message: 'Faltan host, email o token' });

      const auth = 'Basic ' + Buffer.from(email + ':' + token).toString('base64');
      const testReq = https.request(
        { hostname: host, port: 443, path: '/rest/api/3/myself', method: 'GET', headers: { Authorization: auth, Accept: 'application/json' } },
        testRes => {
          let data = '';
          testRes.on('data', c => data += c);
          testRes.on('end', () => {
            if (testRes.statusCode >= 400) {
              console.error('[SETUP] test-connection falló:', testRes.statusCode);
              return sendJson(res, 200, { ok: false, status: testRes.statusCode, message: `HTTP ${testRes.statusCode} — revisá host, email o token` });
            }
            try { const me = JSON.parse(data); sendJson(res, 200, { ok: true, displayName: me.displayName || email, accountId: me.accountId }); }
            catch { sendJson(res, 200, { ok: false, message: 'Respuesta inesperada de Jira' }); }
          });
        }
      );
      testReq.on('error', err => { console.error('[SETUP] test-connection error:', err.message); sendJson(res, 200, { ok: false, message: err.message }); });
      testReq.end();   // el token nunca se loguea
    });
    return;
  }

  // ── Detectar custom fields de la instancia (para el mapeo del wizard) ───────
  if (parsed.pathname === '/setup/detect-fields') {
    if (secretsMissing().length) { sendJson(res, 200, { ok: false, message: 'Falta la conexión con Jira (variables de entorno)' }); return; }
    (async () => {
      try {
        const fields = await jiraGet('/rest/api/3/field');
        const custom = (Array.isArray(fields) ? fields : [])
          .filter(f => f && f.custom)
          .map(f => ({ id: f.id, name: f.name, type: (f.schema && f.schema.type) || '' }));
        sendJson(res, 200, { ok: true, fields: custom });
      } catch (e) {
        console.error('[SETUP] detect-fields falló:', e.message);
        sendJson(res, 200, { ok: false, message: e.message });
      }
    })();
    return;
  }

  // ── Cambiar el tablero activo de un tipo (selector del header, Fase 2) ─────
  if (req.method === 'POST' && parsed.pathname === '/setup/active-board') {
    let body = [];
    req.on('data', c => body.push(c));
    req.on('end', () => {
      let p;
      try { p = JSON.parse(Buffer.concat(body).toString()); }
      catch { return sendJson(res, 400, { ok: false, message: 'JSON inválido' }); }
      const type = p.type, boardId = p.boardId;
      if (!['qa', 'bug', 'tech'].includes(type)) return sendJson(res, 422, { ok: false, message: 'type inválido' });

      const raw = loadRawConfig();
      if (!raw || raw.__parseError) return sendJson(res, 409, { ok: false, message: 'No hay qa-config.json válido para editar' });
      const grp = raw.boards && raw.boards[type];
      if (!grp || !Array.isArray(grp.items) || !grp.items.some(b => b && b.id === boardId)) {
        return sendJson(res, 422, { ok: false, message: `boardId "${boardId}" no existe en ${type}` });
      }
      grp.activeBoardId = boardId;
      const problems = validateConfig(raw);
      if (problems.length) return sendJson(res, 422, { ok: false, problems });
      try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + '\n'); }
      catch (e) { console.error('[SETUP] no se pudo escribir qa-config.json:', e.message); return sendJson(res, 500, { ok: false, error: e.message }); }
      _cfgCache.mtimeMs = null;   // el próximo getConfig resuelve el nuevo activo
      console.log(`[SETUP] tablero activo ${type} → ${boardId}`);
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  // ── Portones (fail-soft) ───────────────────────────────────────────────────
  // 1) Faltan SECRETOS  → /connect  (portón de arranque mínimo: solo lo que falta).
  // 2) Falta CONFIG      → /setup    (wizard de personalización, SIN conexión).
  // Solo se interceptan las páginas de la app; los assets (css/js) y los endpoints
  // /setup/*, /connect, /config.js, /jira, /wiki pasan siempre.
  {
    const missingSecrets = secretsMissing().length > 0;
    const setupRequired  = getConfig().setupRequired;
    const p = parsed.pathname;
    const appRoutes = ['/', '/history', '/jira-editor', '/bg-verificacion', '/actividades',
                       '/Qa_form.html', '/history.html', '/jira_editor.html', '/bg_verificacion.html', '/actividades.html'];
    const isApp = appRoutes.includes(p);
    if (missingSecrets) {
      if (isApp || p === '/setup') { res.writeHead(302, { Location: '/connect' }); res.end(); return; }
    } else if (setupRequired) {
      if (isApp) { res.writeHead(302, { Location: '/setup' }); res.end(); return; }
    }
  }

  // ── Diagnóstico de campos (categoría del proyecto QA) ──────────────────────
  if (parsed.pathname === '/debug/campos-qaa') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    (async () => {
      try {
        const _cfg        = getConfig().config;
        const qaProject   = _cfg.projects.qa;
        const categoryFld = _cfg.fields.category;
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
            const flds   = getConfig().config.fields;
            const fEmail = flds.reporterEmail;
            const fName  = flds.reporterName;
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
               : parsed.pathname === '/setup'             ? '/setup.html'
               : parsed.pathname === '/connect'           ? '/connect.html'
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
    // Anti-cache para HTML y JS: el navegador siempre revalida y nunca sirve una
    // versión vieja de las páginas o scripts (evita el clásico "todo sigue igual").
    if (ext === '.js' || ext === '.html') headers['Cache-Control'] = 'no-cache, must-revalidate';
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
