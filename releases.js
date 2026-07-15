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
const HISTORIAL_PAGE_ID = APP_CONFIG.confluence.historyPageId;
const CONFLUENCE_BASE   = window.location.origin + '/wiki/rest/api';

// ── Jira: versiones ───────────────────────────────────────────────────────────

async function resolverProjectId() {
  if (projectIdQAA) return projectIdQAA;
  const r = await fetch(`/jira/rest/api/3/project/${APP_CONFIG.projects.qa}`, {
    headers: { 'Authorization': AUTH, 'Accept': 'application/json' }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  projectIdQAA = (await r.json()).id;
  return projectIdQAA;
}

async function obtenerVersionActiva() {
  const r = await fetch(`/jira/rest/api/3/project/${APP_CONFIG.projects.qa}/versions`, {
    headers: { 'Authorization': AUTH, 'Accept': 'application/json' }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const activas = (await r.json())
    .filter(v => !v.released && v.name.startsWith(APP_CONFIG.workflow.versionPrefix))
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

async function calcularSiguienteVersion() {
  const r    = await fetch(`/jira/rest/api/3/project/${APP_CONFIG.projects.qa}/versions`, {
    headers: { 'Authorization': AUTH, 'Accept': 'application/json' }
  });
  const todas = r.ok ? await r.json() : [];
  const test  = todas.filter(v => v.name.startsWith(APP_CONFIG.workflow.versionPrefix));

  // Si ya hay otra versión sin publicar (distinta a la activa), es la siguiente
  const sinPublicar = test
    .filter(v => !v.released && v.name !== window.versionActual)
    .sort((a, b) => b.name.localeCompare(a.name));
  if (sinPublicar.length) return sinPublicar[0].name;

  // Si no, siguiente = max global (publicadas + no publicadas) + 1
  const maxNum = test.reduce((max, v) => Math.max(max, parseInt(v.name.replace(APP_CONFIG.workflow.versionPrefix, ''), 10)), 0);
  return `${APP_CONFIG.workflow.versionPrefix}${String(maxNum + 1).padStart(3, '0')}`;
}

async function iniciarSesion(motivo = 'New session') {
  const projectId = await resolverProjectId();

  const rAll = await fetch(`/jira/rest/api/3/project/${APP_CONFIG.projects.qa}/versions`, {
    headers: { 'Authorization': AUTH, 'Accept': 'application/json' }
  });
  const todas = rAll.ok ? await rAll.json() : [];
  const test  = todas.filter(v => v.name.startsWith(APP_CONFIG.workflow.versionPrefix));

  // En este punto la versión publicada ya fue cerrada, así que cualquier
  // sin-publicar que quede es una versión futura pre-existente — no crear otra.
  const sinPublicar = test
    .filter(v => !v.released)
    .sort((a, b) => b.name.localeCompare(a.name));

  if (sinPublicar.length) {
    window.versionActual   = sinPublicar[0].name;
    window.versionActualId = sinPublicar[0].id;
  } else {
    // Calcular siguiente sobre el máximo global (publicadas + no publicadas)
    const maxNum  = test.reduce((max, v) => Math.max(max, parseInt(v.name.replace(APP_CONFIG.workflow.versionPrefix, ''), 10)), 0);
    const nombre  = `${APP_CONFIG.workflow.versionPrefix}${String(maxNum + 1).padStart(3, '0')}`;
    const r = await fetch(`/jira/rest/api/3/version`, {
      method: 'POST',
      headers: { 'Authorization': AUTH, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        name: nombre, description: motivo,
        projectId: parseInt(projectId), released: false,
        startDate: new Date().toISOString().split('T')[0]
      })
    });
    if (!r.ok) { const e = await r.json(); throw new Error(JSON.stringify(e.errors || e)); }
    const creada = await r.json();
    window.versionActual   = nombre;
    window.versionActualId = creada.id;
  }

  const badge = document.getElementById('version-actual');
  if (badge) badge.textContent = window.versionActual;
  return window.versionActual;
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
  const motivo = prompt(`Versió n actual: ${window.versionActual || 'ninguna'}\n\nMotivo:`, '');
  if (motivo === null) return;
  const btn = document.getElementById('btn-avanzar-version');
  if (btn) btn.disabled = true;
  try {
    await iniciarSesion(motivo.trim() || 'New session');
  } catch(e) {
    alert(`Error: ${e.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Jira: datos de versión ────────────────────────────────────────────────────

async function obtenerDatosVersion(nombreVersion) {
  // Fetch all QAA issues paginated. La API nueva de Jira Cloud ignora `startAt`
  // y NO devuelve `total` — solo `nextPageToken` + `isLast`.
  const allIssues = [];
  let nextPageToken = null;
  const jql = encodeURIComponent(
    `project = ${APP_CONFIG.projects.qa} AND fixVersion = "${nombreVersion}" AND issuetype != Epic ORDER BY created ASC`
  );
  while (true) {
    let url = `/jira/rest/api/3/search/jql?jql=${jql}&fields=summary,status,priority,labels,parent,assignee,created,issuelinks,issuetype,subtasks&maxResults=100`;
    if (nextPageToken) url += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;
    const r = await fetch(url, { headers: { 'Authorization': AUTH, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`Jira search: HTTP ${r.status}`);
    const d = await r.json();
    allIssues.push(...(d.issues || []));
    if (d.isLast || !d.nextPageToken || !(d.issues?.length)) break;
    nextPageToken = d.nextPageToken;
  }

  // Extract BG bug keys from issuelinks and build QAA→BG map
  const bgKeySet = new Set();
  const qaaToBg  = {};
  for (const issue of allIssues) {
    const links = (issue.fields.issuelinks || [])
      .map(l => l.inwardIssue || l.outwardIssue)
      .filter(l => l?.key?.startsWith(`${APP_CONFIG.projects.bug}-`));
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

  const passIssues       = allIssues.filter(i => hasLbl(i, 'estado-pass'));
  const failIssues       = allIssues.filter(i => hasLbl(i, 'estado-fail'));
  const blockedIssues    = allIssues.filter(i => hasLbl(i, 'estado-blocked'));
  const retestIssues     = allIssues.filter(i => hasLbl(i, 'retest'));
  const configIssues     = allIssues.filter(i => hasLbl(i, 'requiere-config'));
  // Actividades: issues hijos del Epic de actividades (creadas por actividades.html)
  const actividadIssues  = allIssues.filter(i => i.fields.parent?.key === APP_CONFIG.epics.activities);

  // Vinculados: BGs enlazados al Epic de verificación (vía issuelinks) que pertenecen a esta versión
  // El proyecto BG no tiene fixVersions definidas, así que se filtran por label de versión.
  let vinculadosKeys = [];
  try {
    const r = await fetch(`/jira/rest/api/3/issue/${APP_CONFIG.epics.verification}?fields=issuelinks`, {
      headers: { 'Authorization': AUTH, 'Accept': 'application/json' }
    });
    if (r.ok) {
      const d = await r.json();
      const bgLinkedKeys = (d.fields?.issuelinks || [])
        .map(l => l.outwardIssue?.key || l.inwardIssue?.key)
        .filter(k => k && k.startsWith(`${APP_CONFIG.projects.bug}-`));
      if (bgLinkedKeys.length) {
        const jql = `key in (${bgLinkedKeys.join(',')}) AND labels = "${nombreVersion}"`;
        const r2 = await fetch(`/jira/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=key&maxResults=100`, {
          headers: { 'Authorization': AUTH, 'Accept': 'application/json' }
        });
        if (r2.ok) {
          const d2 = await r2.json();
          vinculadosKeys = (d2.issues || []).map(i => i.key);
        }
      }
    }
  } catch(e) { console.warn('[vinculados] error:', e.message); }

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
      total:        allIssues.length,
      pass:         passIssues.length,
      fail:         failIssues.length,
      blocked:      blockedIssues.length,
      retest:       retestIssues.length,
      config:       configIssues.length,
      actividades:  actividadIssues.length,
      vinculados:   vinculadosKeys.length,
      vinculadosKeys,
    },
    // Backward compat for abrirModalPublicar
    requiereConfig: configIssues.length > 0,
    pasosConfig:    configIssues.map(i => ({ key: i.key, summary: i.fields.summary })),
    bugsFijos:      bgIssues.length ? bgIssues.map(i => i.key) : failIssues.map(i => i.key),
  };
}

// ── Completar issues de una versión ──────────────────────────────────────────

async function completarIssuesDeVersion(allIssues) {
  // Recolectar issues + sus subtareas (que pueden no tener fixVersion)
  const subtaskKeys = allIssues.flatMap(i => (i.fields.subtasks || []).map(s => s.key));
  const extras = [];
  if (subtaskKeys.length) {
    const r = await fetch(
      `/jira/rest/api/3/search/jql?jql=${encodeURIComponent(`key in (${subtaskKeys.join(',')})`)}&fields=status,issuetype&maxResults=200`,
      { headers: { 'Authorization': AUTH, 'Accept': 'application/json' } }
    );
    if (r.ok) extras.push(...((await r.json()).issues || []));
  }

  const todos = [...allIssues, ...extras];
  const pendientes = todos.filter(i => i.fields.status?.statusCategory?.key !== 'done');
  if (!pendientes.length) return;

  // Cache de transition ID por tipo de issue para evitar N+1
  const cache = {};
  const getTransId = async issue => {
    const tipo = issue.fields.issuetype?.name || 'Task';
    if (cache[tipo] !== undefined) return cache[tipo];
    const r = await fetch(`/jira/rest/api/3/issue/${issue.key}/transitions`, {
      headers: { 'Authorization': AUTH, 'Accept': 'application/json' }
    });
    if (!r.ok) { cache[tipo] = null; return null; }
    const { transitions } = await r.json();
    const done = transitions.find(t =>
      ['done', 'cerrada', 'completada', 'closed', 'complete', 'resuelto', 'finalizado'].includes(t.name.toLowerCase())
    );
    cache[tipo] = done?.id ?? null;
    return cache[tipo];
  };

  await Promise.allSettled(
    pendientes.map(async issue => {
      const transId = await getTransId(issue);
      if (!transId) return;
      await fetch(`/jira/rest/api/3/issue/${issue.key}/transitions`, {
        method:  'POST',
        headers: { 'Authorization': AUTH, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ transition: { id: transId } }),
      });
    })
  );
}

// ── Confluence ────────────────────────────────────────────────────────────────

async function agregarAlHistorialConfluence({ version, motivo, observaciones, datos }) {
  const { stats, byModule, bgIssues, bgBySeverity, retestIssues, configIssues, qaaToBg } = datos;
  // Todo el contenido enviado a Confluence se genera en INGLÉS (request del usuario).
  const fecha   = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const tasa    = stats.total > 0 ? `${Math.round((stats.pass / stats.total) * 100)}%` : '—';
  const JIRA_UI = APP_CONFIG.jira.baseUrl;
  const WIKI_V1 = window.location.origin + '/wiki/rest/api';

  const jqlBase  = `project = ${APP_CONFIG.projects.qa} AND fixVersion = "${version}" AND issuetype != Epic`;
  const jqlUrl   = extra => `${JIRA_UI}/issues/?jql=${encodeURIComponent(extra ? `${jqlBase} AND ${extra}` : jqlBase)}`;
  const issueUrl = key   => `${JIRA_UI}/browse/${key}`;
  const link     = (key, label) => `<a href="${issueUrl(key)}">${label ?? key}</a>`;

  const statusBadge = issue => {
    const l = issue.fields.labels || [];
    if (l.includes('estado-pass'))    return `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">Pass</span>`;
    if (l.includes('estado-fail'))    return `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">Fail</span>`;
    if (l.includes('estado-blocked')) return `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">Blocked</span>`;
    if (l.includes('retest'))         return `<span style="background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">Retest</span>`;
    return `<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:4px;font-size:11px">Pending</span>`;
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
    critico: { panel: 'error',   label: 'Critical' },
    mayor:   { panel: 'warning', label: 'Major'    },
    medio:   { panel: 'note',    label: 'Medium'   },
    menor:   { panel: 'info',    label: 'Minor'    },
    bajo:    { panel: 'tip',     label: 'Low'      },
  };

  const macro = (name, title, body) =>
    `<ac:structured-macro ac:name="${name}"><ac:parameter ac:name="title">${title}</ac:parameter><ac:rich-text-body>${body}</ac:rich-text-body></ac:structured-macro>`;

  // ── 1. Executive summary ──────────────────────────────────────────────────
  const sevResumen = Object.entries(bgBySeverity)
    .filter(([, v]) => v.length)
    .map(([s, v]) => `${v.length} ${bgSevMeta[s]?.label || s}`)
    .join(' · ');

  // URL to the Releases page of the QAA project
  const releasesUrl = `${JIRA_UI}/projects/${APP_CONFIG.projects.qa}?selectedItem=com.atlassian.jira.jira-projects-plugin%3Arelease-page&status=no-filter`;
  const versionLink = `<a href="${releasesUrl}">${version}</a>`;
  // JQL URL for all BG bugs reported in this session
  const bgBugsJqlUrl = bgIssues.length
    ? `${JIRA_UI}/issues/?jql=${encodeURIComponent(`key in (${bgIssues.map(b => b.key).join(',')})`)}`
    : '#';
  const bgBugsLink = bgIssues.length
    ? `<a href="${bgBugsJqlUrl}">${bgIssues.length}</a>`
    : '0';

  const resumen = macro('info',
    `${version} — QA Session`,
    `<p><strong>Version:</strong> ${versionLink} &nbsp;|&nbsp; <strong>Date:</strong> ${fecha} &nbsp;|&nbsp; <strong>Modules covered:</strong> ${Object.keys(byModule).length} &nbsp;|&nbsp; <strong>Pass rate:</strong> <strong>${tasa}</strong></p>
     <p><strong>Closing reason:</strong> ${motivo}</p>
     ${bgIssues.length
       ? `<p><strong>BG Bugs reported:</strong> ${bgBugsLink} &nbsp;(${sevResumen})</p>`
       : `<p><strong>BG Bugs:</strong> None in this session.</p>`}`
  );

  // ── 2. Metrics table with JQL links ──────────────────────────────────────
  // URL for the "Linked" JQL — uses key in (...) to show exactly the computed BGs
  const vinculadosJqlUrl = stats.vinculadosKeys?.length
    ? `${JIRA_UI}/issues/?jql=${encodeURIComponent(`key in (${stats.vinculadosKeys.join(',')})`)}`
    : `${JIRA_UI}/browse/${APP_CONFIG.epics.verification}`;

  // Version and Date removed — already shown in the summary header.
  const metricasTable = `<table><tbody>
    <tr>
      <th>Total</th>
      <th>Pass</th>
      <th>Fail</th>
      <th>Blocked</th>
      <th>Retest</th>
      <th>Activities</th>
      <th>Linked</th>
      <th>Rate</th>
    </tr>
    <tr>
      <td style="text-align:center"><strong><a href="${jqlUrl()}">${stats.total}</a></strong></td>
      <td style="text-align:center;color:#15803d"><strong><a href="${jqlUrl('labels = "estado-pass"')}" style="color:inherit">${stats.pass}</a></strong></td>
      <td style="text-align:center;color:#991b1b"><strong><a href="${jqlUrl('labels = "estado-fail"')}" style="color:inherit">${stats.fail}</a></strong></td>
      <td style="text-align:center;color:#92400e"><strong><a href="${jqlUrl('labels = "estado-blocked"')}" style="color:inherit">${stats.blocked}</a></strong></td>
      <td style="text-align:center;color:#6d28d9"><strong><a href="${jqlUrl('labels = "retest"')}" style="color:inherit">${stats.retest}</a></strong></td>
      <td style="text-align:center;color:#0369a1"><strong><a href="${jqlUrl(`parent = ${APP_CONFIG.epics.activities}`)}" style="color:inherit">${stats.actividades}</a></strong></td>
      <td style="text-align:center;color:#7c3aed"><strong><a href="${vinculadosJqlUrl}" style="color:inherit">${stats.vinculados}</a></strong></td>
      <td style="text-align:center"><strong>${tasa}</strong></td>
    </tr>
  </tbody></table>`;

  // ── 3. Module breakdown (expandable) ──────────────────────────────────────
  const EPIC_LABELS = {
    [APP_CONFIG.epics.verification]: 'BG Verification',
    [APP_CONFIG.epics.activities]: 'Activities and Suggestions',
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
      ? `No module | ${mod.issues.length} issues`
      : `${mod.key} — ${label} | ${mod.issues.length} issues | ${summary}`;

    return { title, rows, summary, passC, failC, blockedC, modTasa };
  };

  // Known Epics first (QAA-172 and QAA-179), then the rest
  const EPIC_ORDER = [APP_CONFIG.epics.verification, APP_CONFIG.epics.activities];
  const sortedModules = [
    ...EPIC_ORDER.filter(k => byModule[k]).map(k => byModule[k]),
    ...Object.values(byModule).filter(m => !EPIC_ORDER.includes(m.key)),
  ];

  // Expand per module: each version stays compact in Confluence.
  // Diagnostic, summary and metrics are always visible;
  // issue tables expand only when needed.
  const modulosHtml = sortedModules.map(mod => {
    const { title, rows } = buildModuleRows(mod);
    return macro('expand', title, `
      <table><tbody>
        <tr><th>Issue</th><th>Summary</th><th>Status</th><th>Priority</th><th>Assignee</th><th>BG Bugs</th></tr>
        ${rows}
      </tbody></table>`);
  }).join('\n');

  const desglose = modulosHtml
    ? `<h3>Module Breakdown</h3>\n${modulosHtml}`
    : '';

  // ── 4. Re-test chain ─────────────────────────────────────────────────────
  const retestHtml = retestIssues.length
    ? macro('info',
        `Re-test Chain (${retestIssues.length})`,
        `<p><a href="${jqlUrl('labels = "retest"')}">View all in Jira →</a></p>` +
        `<ol>${retestIssues.map(i => `<li>${link(i.key)}: ${i.fields.summary} &nbsp;${statusBadge(i)}</li>`).join('')}</ol>`
      )
    : '';

  // ── 6. Server configuration ──────────────────────────────────────────────
  const configHtml = configIssues.length
    ? macro('note',
        `Server Configuration Required (${configIssues.length})`,
        `<p><a href="${jqlUrl('labels = "requiere-config"')}">View all in Jira →</a></p>` +
        `<ol>${configIssues.map(i => `<li>${link(i.key)}: ${i.fields.summary}</li>`).join('')}</ol>` +
        `<p><em>Coordinate with infrastructure before deployment.</em></p>`
      )
    : macro('tip', 'No configuration changes',
        '<p>The server requires no additional adjustments for this version.</p>');

  // ── 7. Observations ──────────────────────────────────────────────────────
  const obsHtml = observaciones
    ? macro('warning', 'Senior QA Observations', `<p>${observaciones}</p>`)
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
      title:   'Published Versions History',
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
  let siguiente = `${APP_CONFIG.workflow.versionPrefix}${String(parseInt(publicada.replace(APP_CONFIG.workflow.versionPrefix,''),10)+1).padStart(3,'0')}`;
  try {
    [datos, siguiente] = await Promise.all([
      obtenerDatosVersion(publicada),
      calcularSiguienteVersion(),
    ]);
  } catch {}

  abrirModalPublicar(publicada, siguiente, datos);
}

function abrirModalPublicar(publicada, siguiente, datos) {
  const { stats, requiereConfig, pasosConfig, bugsFijos } = datos;
  const tasa = stats.total > 0 ? Math.round((stats.pass / stats.total) * 100) + '%' : '—';

  const bugsHtml = bugsFijos.length
    ? bugsFijos.map(k => `<a href="${APP_CONFIG.jira.browseUrl}${k}" target="_blank"
        style="display:inline-block;padding:2px 8px;background:#fee2e2;color:#991b1b;border-radius:6px;font-size:11px;font-weight:700;text-decoration:none;margin:2px">${k}</a>`).join('')
    : '<span style="font-size:12px;color:var(--g4)">Ninguno</span>';

  const configHtml = requiereConfig
    ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px;font-size:12px;color:#92400e">
        ⚙️ <strong>${pasosConfig.length} tarea${pasosConfig.length !== 1 ? 's' : ''} requieren configuración:</strong>
        <ul style="margin:6px 0 0 0;padding-left:16px">${pasosConfig.map(p=>`<li><a href="${APP_CONFIG.jira.browseUrl}${p.key}" target="_blank" style="color:#92400e;font-weight:700">${p.key}</a>: ${p.summary}</li>`).join('')}</ul>
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
  const motivo        = document.getElementById('pub-motivo').value.trim() || 'No reason provided';
  const observaciones = document.getElementById('pub-obs').value.trim();
  const motivoSig     = document.getElementById('pub-siguiente-motivo').value.trim() || 'New session';

  closeModal();
  setLoading(true);

  try {
    const datos = await obtenerDatosVersion(publicada);

    // Completar todas las tareas y subtareas antes de cerrar la versión
    await completarIssuesDeVersion(datos.allIssues);

    // Confluence primero — si falla, no publicamos en Jira
    await agregarAlHistorialConfluence({ version: publicada, motivo, observaciones, datos });

    await cerrarSesion();
    window.versionActual = null; window.versionActualId = null;

    await iniciarSesion(motivoSig);

    const confUrl = `${APP_CONFIG.jira.baseUrl}/wiki/spaces/${APP_CONFIG.confluence.space}/pages/${HISTORIAL_PAGE_ID}`;
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
