/**
 * releases.js — Sistema de versiones Jira + historial Confluence
 *
 * Expone en window:
 *   versionActual, versionActualId  — leídos por Qa_form.html al crear issues
 *
 * Depende de globals definidos en Qa_form.html:
 *   AUTH, showModal, closeModal, showError, setLoading
 */

// ── Estado ────────────────────────────────────────────────────────────────────
window.versionActual   = null;
window.versionActualId = null;
let projectIdQAA       = null;

// ── Constantes ────────────────────────────────────────────────────────────────
const HISTORIAL_PAGE_ID = '78053377';
const CONFLUENCE_BASE   = window.location.origin + '/wiki/rest/api';

// ── Jira: versiones ───────────────────────────────────────────────────────────

async function resolverProjectId() {
  if (projectIdQAA) return projectIdQAA;
  const r = await fetch(`/jira/rest/api/3/project/QAA`, {
    headers: { 'Authorization': AUTH, 'Accept': 'application/json' }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  projectIdQAA = (await r.json()).id;
  return projectIdQAA;
}

async function obtenerVersionActiva() {
  const r = await fetch(`/jira/rest/api/3/project/QAA/versions`, {
    headers: { 'Authorization': AUTH, 'Accept': 'application/json' }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const activas = (await r.json())
    .filter(v => !v.released && v.name.startsWith('test-v'))
    .sort((a, b) => b.name.localeCompare(a.name));
  if (!activas.length) throw new Error('Sin versión activa');
  return activas[0];
}

async function inicializarSistemaVersiones() {
  const badge = document.getElementById('version-actual');
  try {
    const v = await obtenerVersionActiva();
    window.versionActual   = v.name;
    window.versionActualId = v.id;
    const icono = (v.description || '').startsWith('⚙️') ? ' ⚙️' : '';
    if (badge) badge.textContent = v.name + icono;
  } catch(e) {
    console.warn('[version]', e.message);
    if (badge) badge.textContent = 'sin versión';
  }
}

async function iniciarSesion(motivo = 'Nueva sesión') {
  const projectId = await resolverProjectId();

  const rAll = await fetch(`/jira/rest/api/3/project/QAA/versions`, {
    headers: { 'Authorization': AUTH, 'Accept': 'application/json' }
  });
  const todas = rAll.ok ? await rAll.json() : [];
  const maxNum = todas
    .filter(v => v.name.startsWith('test-v'))
    .reduce((max, v) => Math.max(max, parseInt(v.name.replace('test-v', ''), 10)), 0);
  const siguiente = `test-v${String(maxNum + 1).padStart(3, '0')}`;

  const r = await fetch(`/jira/rest/api/3/version`, {
    method: 'POST',
    headers: { 'Authorization': AUTH, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      name: siguiente, description: motivo,
      projectId: parseInt(projectId), released: false,
      startDate: new Date().toISOString().split('T')[0]
    })
  });
  if (!r.ok) { const e = await r.json(); throw new Error(JSON.stringify(e.errors || e)); }
  const creada = await r.json();
  window.versionActual   = siguiente;
  window.versionActualId = creada.id;

  const badge = document.getElementById('version-actual');
  if (badge) badge.textContent = siguiente;
  return siguiente;
}

async function cerrarSesion() {
  if (!window.versionActualId) throw new Error('Sin ID de versión activa');
  const r = await fetch(`/jira/rest/api/3/version/${window.versionActualId}`, {
    method: 'PUT',
    headers: { 'Authorization': AUTH, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ released: true, releaseDate: new Date().toISOString().split('T')[0] })
  });
  if (!r.ok) { const e = await r.json(); throw new Error(JSON.stringify(e.errors || e)); }
}

async function promptAvanzarVersion() {
  const motivo = prompt(`Versión actual: ${window.versionActual || 'ninguna'}\n\nMotivo:`, '');
  if (motivo === null) return;
  const btn = document.getElementById('btn-avanzar-version');
  if (btn) btn.disabled = true;
  try {
    await iniciarSesion(motivo.trim() || 'Nueva sesión');
  } catch(e) {
    alert(`Error: ${e.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Jira: datos de versión ────────────────────────────────────────────────────

async function obtenerDatosVersion(nombreVersion) {
  // Fetch all QAA issues paginated — full fields
  const allIssues = [];
  let startAt = 0;
  while (true) {
    const jql = encodeURIComponent(
      `project = QAA AND fixVersion = "${nombreVersion}" AND issuetype != Epic ORDER BY created ASC`
    );
    const r = await fetch(
      `/jira/rest/api/3/search/jql?jql=${jql}&fields=summary,status,priority,labels,parent,assignee,created,issuelinks,issuetype&maxResults=100&startAt=${startAt}`,
      { headers: { 'Authorization': AUTH, 'Accept': 'application/json' } }
    );
    if (!r.ok) throw new Error(`Jira search: HTTP ${r.status}`);
    const d = await r.json();
    allIssues.push(...(d.issues || []));
    if (allIssues.length >= (d.total || 0) || !(d.issues?.length)) break;
    startAt += 100;
  }

  // Extract BG bug keys from issuelinks and build QAA→BG map
  const bgKeySet = new Set();
  const qaaToBg  = {};
  for (const issue of allIssues) {
    const links = (issue.fields.issuelinks || [])
      .map(l => l.inwardIssue || l.outwardIssue)
      .filter(l => l?.key?.startsWith('BG-'));
    links.forEach(l => bgKeySet.add(l.key));
    if (links.length) qaaToBg[issue.key] = links.map(l => l.key);
  }

  // Fetch full BG bug details in batches of 50
  const bgIssues  = [];
  const bgKeysArr = [...bgKeySet];
  for (let i = 0; i < bgKeysArr.length; i += 50) {
    const batch = bgKeysArr.slice(i, i + 50).join(',');
    const r = await fetch(
      `/jira/rest/api/3/search/jql?jql=${encodeURIComponent(`key in (${batch}) ORDER BY priority DESC`)}&fields=summary,priority,status,labels&maxResults=50`,
      { headers: { 'Authorization': AUTH, 'Accept': 'application/json' } }
    );
    if (r.ok) bgIssues.push(...((await r.json()).issues || []));
  }

  const lbls   = i => i.fields.labels || [];
  const hasLbl = (i, l) => lbls(i).includes(l);

  const passIssues    = allIssues.filter(i => hasLbl(i, 'estado-pass'));
  const failIssues    = allIssues.filter(i => hasLbl(i, 'estado-fail'));
  const blockedIssues = allIssues.filter(i => hasLbl(i, 'estado-blocked'));
  const retestIssues  = allIssues.filter(i => hasLbl(i, 'retest'));
  const configIssues  = allIssues.filter(i => hasLbl(i, 'requiere-config'));

  // Group by parent module
  const byModule = {};
  for (const issue of allIssues) {
    const pk = issue.fields.parent?.key || 'sin-modulo';
    const pn = issue.fields.parent?.fields?.summary || 'Sin módulo';
    if (!byModule[pk]) byModule[pk] = { key: pk, name: pn, issues: [] };
    byModule[pk].issues.push(issue);
  }

  // BG bugs grouped by severity label
  const SEV_ORDER    = ['critico', 'mayor', 'medio', 'menor', 'bajo'];
  const bgBySeverity = Object.fromEntries(SEV_ORDER.map(s => [s, []]));
  for (const bg of bgIssues) {
    const sev = (lbls(bg).find(l => l.startsWith('severity-')) || 'severity-medio').replace('severity-', '');
    (bgBySeverity[sev] ?? bgBySeverity.medio).push(bg);
  }

  return {
    allIssues, bgIssues, bgBySeverity, byModule, qaaToBg,
    passIssues, failIssues, blockedIssues, retestIssues, configIssues,
    stats: {
      total:   allIssues.length,
      pass:    passIssues.length,
      fail:    failIssues.length,
      blocked: blockedIssues.length,
      retest:  retestIssues.length,
      config:  configIssues.length,
    },
    // Backward compat for abrirModalPublicar
    requiereConfig: configIssues.length > 0,
    pasosConfig:    configIssues.map(i => ({ key: i.key, summary: i.fields.summary })),
    bugsFijos:      bgIssues.length ? bgIssues.map(i => i.key) : failIssues.map(i => i.key),
  };
}

// ── Confluence ────────────────────────────────────────────────────────────────

async function agregarAlHistorialConfluence({ version, motivo, observaciones, datos }) {
  const { stats, byModule, bgIssues, bgBySeverity, retestIssues, configIssues, qaaToBg } = datos;
  const fecha   = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
  const tasa    = stats.total > 0 ? `${Math.round((stats.pass / stats.total) * 100)}%` : '—';
  const JIRA_UI = 'https://liceopinoverde.atlassian.net';
  const WIKI_V1 = window.location.origin + '/wiki/rest/api';

  const jqlBase  = `project = QAA AND fixVersion = "${version}" AND issuetype != Epic`;
  const jqlUrl   = extra => `${JIRA_UI}/issues/?jql=${encodeURIComponent(extra ? `${jqlBase} AND ${extra}` : jqlBase)}`;
  const issueUrl = key   => `${JIRA_UI}/browse/${key}`;
  const link     = (key, label) => `<a href="${issueUrl(key)}">${label ?? key}</a>`;

  const statusBadge = issue => {
    const l = issue.fields.labels || [];
    if (l.includes('estado-pass'))    return `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">Pass</span>`;
    if (l.includes('estado-fail'))    return `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">Fail</span>`;
    if (l.includes('estado-blocked')) return `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">Blocked</span>`;
    if (l.includes('retest'))         return `<span style="background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">Retest</span>`;
    return `<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:4px;font-size:11px">Pendiente</span>`;
  };

  const prioBadge = issue => {
    const p = issue.fields.priority?.name || '—';
    const styles = {
      Highest: 'background:#fee2e2;color:#991b1b',
      High:    'background:#fff7ed;color:#c2410c',
      Medium:  'background:#fefce8;color:#a16207',
      Low:     'background:#f0fdf4;color:#166534',
      Lowest:  'background:#f8fafc;color:#64748b',
    };
    return `<span style="${styles[p] || styles.Lowest};padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700">${p}</span>`;
  };

  const bgSevMeta = {
    critico: { panel: 'error',   label: 'Critico' },
    mayor:   { panel: 'warning', label: 'Mayor'   },
    medio:   { panel: 'note',    label: 'Medio'   },
    menor:   { panel: 'info',    label: 'Menor'   },
    bajo:    { panel: 'tip',     label: 'Bajo'    },
  };

  const macro = (name, title, body) =>
    `<ac:structured-macro ac:name="${name}"><ac:parameter ac:name="title">${title}</ac:parameter><ac:rich-text-body>${body}</ac:rich-text-body></ac:structured-macro>`;

  // ── 1. Resumen ejecutivo ──────────────────────────────────────────────────
  const sevResumen = Object.entries(bgBySeverity)
    .filter(([, v]) => v.length)
    .map(([s, v]) => `${v.length} ${bgSevMeta[s]?.label || s}`)
    .join(' · ');

  const resumen = macro('info',
    `${version} — Sesion QA`,
    `<p><strong>Fecha:</strong> ${fecha} &nbsp;|&nbsp; <strong>Modulos cubiertos:</strong> ${Object.keys(byModule).length} &nbsp;|&nbsp; <strong>Pass rate:</strong> <strong>${tasa}</strong></p>
     <p><strong>Motivo de cierre:</strong> ${motivo}</p>
     ${bgIssues.length
       ? `<p><strong>BG Bugs reportados:</strong> ${bgIssues.length} &nbsp;(${sevResumen})</p>`
       : `<p><strong>BG Bugs:</strong> Ninguno en esta sesion.</p>`}`
  );

  // ── 2. Tabla de métricas con links JQL ───────────────────────────────────
  const metricasTable = `<table><tbody>
    <tr>
      <th>Version</th>
      <th>Fecha</th>
      <th>Total</th>
      <th>Pass</th>
      <th>Fail</th>
      <th>Blocked</th>
      <th>Retest</th>
      <th>Tasa</th>
    </tr>
    <tr>
      <td><strong>${version}</strong></td>
      <td style="white-space:nowrap">${fecha}</td>
      <td style="text-align:center"><strong><a href="${jqlUrl()}">${stats.total}</a></strong></td>
      <td style="text-align:center;color:#15803d"><strong><a href="${jqlUrl('labels = "estado-pass"')}" style="color:inherit">${stats.pass}</a></strong></td>
      <td style="text-align:center;color:#991b1b"><strong><a href="${jqlUrl('labels = "estado-fail"')}" style="color:inherit">${stats.fail}</a></strong></td>
      <td style="text-align:center;color:#92400e"><strong><a href="${jqlUrl('labels = "estado-blocked"')}" style="color:inherit">${stats.blocked}</a></strong></td>
      <td style="text-align:center;color:#6d28d9"><strong><a href="${jqlUrl('labels = "retest"')}" style="color:inherit">${stats.retest}</a></strong></td>
      <td style="text-align:center"><strong>${tasa}</strong></td>
    </tr>
  </tbody></table>`;

  // ── 3. Desglose por módulo (expandibles) ──────────────────────────────────
  const EPIC_LABELS = {
    'QAA-172': 'Verificacion BG',
    'QAA-179': 'Actividades y Sugerencias',
  };

  const buildModuleRows = mod => {
    const passC    = mod.issues.filter(i => (i.fields.labels||[]).includes('estado-pass')).length;
    const failC    = mod.issues.filter(i => (i.fields.labels||[]).includes('estado-fail')).length;
    const blockedC = mod.issues.filter(i => (i.fields.labels||[]).includes('estado-blocked')).length;
    const modTasa  = mod.issues.length > 0 ? `${Math.round((passC / mod.issues.length) * 100)}%` : '—';
    const summary  = `Pass: ${passC} · Fail: ${failC} · Blocked: ${blockedC} · ${modTasa}`;

    const rows = mod.issues.map(issue => {
      const bgKeys = qaaToBg[issue.key] || [];
      const bgCell = bgKeys.length
        ? bgKeys.map(k => `<a href="${issueUrl(k)}" style="display:inline-block;margin:1px;padding:1px 6px;background:#fee2e2;color:#991b1b;border-radius:3px;font-size:10px;font-weight:700">${k}</a>`).join('')
        : '<span style="color:#94a3b8;font-size:11px">—</span>';

      return `<tr>
        <td><a href="${issueUrl(issue.key)}" style="font-weight:700;white-space:nowrap">${issue.key}</a></td>
        <td>${issue.fields.summary}</td>
        <td style="white-space:nowrap">${statusBadge(issue)}</td>
        <td style="text-align:center">${prioBadge(issue)}</td>
        <td style="white-space:nowrap">${issue.fields.assignee?.displayName || '<span style="color:#94a3b8">—</span>'}</td>
        <td>${bgCell}</td>
      </tr>`;
    }).join('');

    const label = EPIC_LABELS[mod.key] || mod.name;
    const title = mod.key === 'sin-modulo'
      ? `Sin modulo | ${mod.issues.length} issues`
      : `${mod.key} — ${label} | ${mod.issues.length} issues | ${summary}`;

    return { title, rows, summary, passC, failC, blockedC, modTasa };
  };

  // Epics conocidos primero (QAA-172 y QAA-179), luego el resto
  const EPIC_ORDER = ['QAA-172', 'QAA-179'];
  const sortedModules = [
    ...EPIC_ORDER.filter(k => byModule[k]).map(k => byModule[k]),
    ...Object.values(byModule).filter(m => !EPIC_ORDER.includes(m.key)),
  ];

  // Expand por modulo: cada version queda compacta en Confluence.
  // El diagnostico, resumen y metricas siempre son visibles;
  // las tablas de issues se despliegan solo cuando se necesitan.
  const modulosHtml = sortedModules.map(mod => {
    const { title, rows } = buildModuleRows(mod);
    return macro('expand', title, `
      <table><tbody>
        <tr><th>Issue</th><th>Resumen</th><th>Estado</th><th>Prioridad</th><th>Asignado</th><th>BG Bugs</th></tr>
        ${rows}
      </tbody></table>`);
  }).join('\n');

  const desglose = modulosHtml
    ? `<h3>Desglose por Modulo</h3>\n${modulosHtml}`
    : '';

  // ── 4. Cadena de re-tests ────────────────────────────────────────────────
  const retestHtml = retestIssues.length
    ? macro('info',
        `Cadena de Re-tests (${retestIssues.length})`,
        `<p><a href="${jqlUrl('labels = "retest"')}">Ver todos en Jira →</a></p>` +
        `<ol>${retestIssues.map(i => `<li>${link(i.key)}: ${i.fields.summary} &nbsp;${statusBadge(i)}</li>`).join('')}</ol>`
      )
    : '';

  // ── 6. Configuración de servidor ─────────────────────────────────────────
  const configHtml = configIssues.length
    ? macro('note',
        `Requiere Configuracion de Servidor (${configIssues.length})`,
        `<p><a href="${jqlUrl('labels = "requiere-config"')}">Ver todos en Jira →</a></p>` +
        `<ol>${configIssues.map(i => `<li>${link(i.key)}: ${i.fields.summary}</li>`).join('')}</ol>` +
        `<p><em>Coordinar con infraestructura antes del despliegue.</em></p>`
      )
    : macro('tip', 'Sin cambios de configuracion',
        '<p>El servidor no requiere ajustes adicionales para esta version.</p>');

  // ── 7. Observaciones ─────────────────────────────────────────────────────
  const obsHtml = observaciones
    ? macro('warning', 'Observaciones del QA Senior', `<p>${observaciones}</p>`)
    : '';

  // ── Entrada final ─────────────────────────────────────────────────────────
  const entrada = [
    `<h2>${version} — ${fecha}</h2>`,
    resumen,
    metricasTable,
    desglose,
    retestHtml,
    configHtml,
    obsHtml,
    '<hr/>',
  ].filter(Boolean).join('\n');

  // ── GET + deduplicar + PUT Confluence ─────────────────────────────────────
  const resPage = await fetch(`${WIKI_V1}/content/${HISTORIAL_PAGE_ID}?expand=body.storage,version`, {
    headers: { 'Accept': 'application/json' }
  });
  if (!resPage.ok) throw new Error(`Confluence GET: HTTP ${resPage.status}`);
  const page    = await resPage.json();
  const verNum  = page.version.number;
  const current = page.body?.storage?.value || '';

  // !! PRIORIDAD — NUNCA borrar versiones anteriores !!
  // Cada version ocupa el bloque entre su <h2> y su <hr/>.
  // Si la version YA existe en el doc → reemplazar SOLO ese bloque (slice exacto).
  // Si es nueva → anteponer al inicio (el contenido viejo queda intacto al final).
  // NUNCA hacer replace/clear del contenido completo de la pagina.
  const marcaInicio = `<h2>${version} `;
  let nuevoContenido;
  const idxInicio = current.indexOf(marcaInicio);
  if (idxInicio !== -1) {
    // Reemplaza solo el bloque de esta version; todo lo anterior y posterior queda intacto
    let idxHr = current.indexOf('<hr/>', idxInicio);
    let hrLen = 5;
    if (idxHr === -1) { idxHr = current.indexOf('<hr>', idxInicio); hrLen = 4; }
    const fin = idxHr !== -1 ? idxHr + hrLen : current.length;
    nuevoContenido = current.slice(0, idxInicio) + entrada + current.slice(fin);
  } else {
    // Version nueva: se agrega al inicio; versiones anteriores no se tocan
    nuevoContenido = entrada + current;
  }

  const resUp = await fetch(`${WIKI_V1}/content/${HISTORIAL_PAGE_ID}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      version: { number: verNum + 1 },
      title:   'Historial de Versiones Publicadas',
      type:    'page',
      body:    { storage: { value: nuevoContenido, representation: 'storage' } }
    })
  });
  if (!resUp.ok) {
    const err = await resUp.json().catch(() => ({}));
    throw new Error(`Confluence PUT: HTTP ${resUp.status} — ${JSON.stringify(err)}`);
  }
}

// ── Modal de publicación ──────────────────────────────────────────────────────

async function promptPublicarVersion() {
  if (!window.versionActual) return alert('No hay versión activa');

  const publicada = window.versionActual;
  const num       = parseInt(publicada.replace('test-v', ''), 10);
  const siguiente = `test-v${String(num + 1).padStart(3, '0')}`;

  showModal('publish',
    `<span style="font-size:18px;font-weight:700">Publicar ${publicada}</span>`,
    `<div style="text-align:center;padding:32px;color:var(--g5)">Cargando datos de Jira...</div>`,
    `<button onclick="closeModal()" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:none;font-size:13px;cursor:pointer">Cancelar</button>`
  );

  let datos = {
    stats: { total:0, pass:0, fail:0, blocked:0, retest:0, config:0 },
    requiereConfig: false, pasosConfig: [], bugsFijos: [],
    bgIssues: [], byModule: {}, bgBySeverity: {}, retestIssues: [], configIssues: [], qaaToBg: {},
  };
  try { datos = await obtenerDatosVersion(publicada); } catch {}

  abrirModalPublicar(publicada, siguiente, datos);
}

function abrirModalPublicar(publicada, siguiente, datos) {
  const { stats, requiereConfig, pasosConfig, bugsFijos } = datos;
  const tasa = stats.total > 0 ? Math.round((stats.pass / stats.total) * 100) + '%' : '—';

  const bugsHtml = bugsFijos.length
    ? bugsFijos.map(k => `<a href="https://liceopinoverde.atlassian.net/browse/${k}" target="_blank"
        style="display:inline-block;padding:2px 8px;background:#fee2e2;color:#991b1b;border-radius:6px;font-size:11px;font-weight:700;text-decoration:none;margin:2px">${k}</a>`).join('')
    : '<span style="font-size:12px;color:var(--g4)">Ninguno</span>';

  const configHtml = requiereConfig
    ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px;font-size:12px;color:#92400e">
        ⚙️ <strong>${pasosConfig.length} tarea${pasosConfig.length !== 1 ? 's' : ''} requieren configuración:</strong>
        <ul style="margin:6px 0 0 0;padding-left:16px">${pasosConfig.map(p=>`<li><a href="https://liceopinoverde.atlassian.net/browse/${p.key}" target="_blank" style="color:#92400e;font-weight:700">${p.key}</a>: ${p.summary}</li>`).join('')}</ul>
       </div>`
    : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;font-size:12px;color:#15803d"> Sin cambios de configuración en esta versión</div>`;

  const body = `
    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:65px;text-align:center;background:var(--g0);border-radius:8px;padding:10px">
        <div style="font-size:22px;font-weight:800;color:var(--g8)">${stats.total}</div>
        <div style="font-size:11px;color:var(--g5)">Total</div>
      </div>
      <div style="flex:1;min-width:65px;text-align:center;background:#dcfce7;border-radius:8px;padding:10px">
        <div style="font-size:22px;font-weight:800;color:#16a34a">${stats.pass}</div>
        <div style="font-size:11px;color:#15803d">Pass</div>
      </div>
      <div style="flex:1;min-width:65px;text-align:center;background:#fee2e2;border-radius:8px;padding:10px">
        <div style="font-size:22px;font-weight:800;color:#dc2626">${stats.fail}</div>
        <div style="font-size:11px;color:#991b1b">Fail</div>
      </div>
      <div style="flex:1;min-width:65px;text-align:center;background:#fef3c7;border-radius:8px;padding:10px">
        <div style="font-size:22px;font-weight:800;color:#d97706">${stats.blocked}</div>
        <div style="font-size:11px;color:#92400e">Blocked</div>
      </div>
      <div style="flex:1;min-width:65px;text-align:center;background:#ede9fe;border-radius:8px;padding:10px">
        <div style="font-size:22px;font-weight:800;color:#7c3aed">${stats.retest||0}</div>
        <div style="font-size:11px;color:#6d28d9">Retest</div>
      </div>
      <div style="flex:1;min-width:65px;text-align:center;background:#dbeafe;border-radius:8px;padding:10px">
        <div style="font-size:22px;font-weight:800;color:#2563eb">${tasa}</div>
        <div style="font-size:11px;color:#1d4ed8">Pass rate</div>
      </div>
    </div>

    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--g5);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Bugs BG / Fails detectados</div>
      ${bugsHtml}
    </div>

    <div style="margin-bottom:12px">${configHtml}</div>

    <div style="display:flex;flex-direction:column;gap:12px">
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--g5);text-transform:uppercase;letter-spacing:.5px">Motivo de cierre <span style="color:#dc2626">*</span></label>
        <textarea id="pub-motivo" rows="2" placeholder="Ej: Fix ChatKit + nuevo puerto MCP"
          style="width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1px solid var(--border);font-size:13px;resize:vertical;box-sizing:border-box"></textarea>
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--g5);text-transform:uppercase;letter-spacing:.5px">Observaciones (opcional)</label>
        <textarea id="pub-obs" rows="2" placeholder="Algo que deba saber el equipo sobre esta versión..."
          style="width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1px solid var(--border);font-size:13px;resize:vertical;box-sizing:border-box"></textarea>
      </div>
      <div style="background:var(--g0);border-radius:8px;padding:12px">
        <div style="font-size:11px;font-weight:700;color:var(--g5);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Siguiente sesión — ${siguiente}</div>
        <input id="pub-siguiente-motivo" type="text" placeholder="¿Qué se va a probar en ${siguiente}?"
          style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);font-size:13px;box-sizing:border-box">
      </div>
    </div>`;

  const footer = `
    <button onclick="closeModal()" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:none;font-size:13px;cursor:pointer">Cancelar</button>
    <button onclick="ejecutarPublicacion('${publicada}','${siguiente}')"
      style="padding:8px 20px;border-radius:8px;background:var(--g8);color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer">
      ✓ Publicar y continuar
    </button>`;

  showModal('publish', `<span style="font-size:18px;font-weight:700">Publicar ${publicada}</span>`, body, footer);
}

async function ejecutarPublicacion(publicada, siguiente) {
  const motivo        = document.getElementById('pub-motivo').value.trim() || 'Sin motivo';
  const observaciones = document.getElementById('pub-obs').value.trim();
  const motivoSig     = document.getElementById('pub-siguiente-motivo').value.trim() || 'Nueva sesión';

  closeModal();
  setLoading(true);

  try {
    const datos = await obtenerDatosVersion(publicada);

    // Confluence primero — si falla, no publicamos en Jira
    await agregarAlHistorialConfluence({ version: publicada, motivo, observaciones, datos });

    await cerrarSesion();
    window.versionActual = null; window.versionActualId = null;

    await iniciarSesion(motivoSig);

    const confUrl = `https://liceopinoverde.atlassian.net/wiki/spaces/QD/pages/${HISTORIAL_PAGE_ID}`;
    showModal('success',
      `<div class="modal-icon success">
        <svg fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
       </div>
       <div><div class="modal-title">${publicada} publicada</div><div class="modal-sub">Historial actualizado en Confluence</div></div>`,
      `<div class="modal-card">
         <div class="modal-card-label">Nueva sesión activa</div>
         <div class="modal-tc">${motivoSig}</div>
       </div>`,
      `<a href="${confUrl}" target="_blank" style="flex:1;text-decoration:none">
         <button class="modal-btn-primary" style="width:100%">Ver en Confluence</button>
       </a>
       <button class="modal-btn-secondary" onclick="closeModal()">Cerrar</button>`
    );

  } catch(e) {
    showError(`<strong>Error publicando:</strong><br>${e.message}`);
  } finally {
    setLoading(false);
  }
}
