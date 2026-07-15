/**
 * bg_reporter.js
 * Crea issues de reporte vinculados a un Test Case QAA:
 *   - crearBugBG  → bug en el proyecto BG
 *   - crearTechSP → tarea técnica (Tech Task) en el proyecto SP (LPV Tech)
 * Depende de las globales: AUTH, JIRA_BASE, mkB, mkH, mkP, mkRule,
 * mkOrderedList, mkBulletList, mkPanel, mkTable, mkTableRow
 */

const _BG_JIRA = APP_CONFIG.jira.baseUrl;

function _mkLinkedRow(label, text, href) {
  const display = String(text || '—');
  const valueContent = (href && display !== '—')
    ? [{ type:'text', text: display, marks:[{ type:'link', attrs:{ href } }] }]
    : [{ type:'text', text: display }];
  return { type:'tableRow', content:[
    { type:'tableHeader', attrs:{}, content:[{ type:'paragraph', content:[{ type:'text', text: String(label) }] }] },
    { type:'tableCell',   attrs:{}, content:[{ type:'paragraph', content: valueContent }] },
  ]};
}

// ── Panel compartido: usuarios asignables ─────────────────────────────────────
// Devuelve los project keys cuyos checkbox de reporte están marcados.
function _proyectosReporteActivos() {
  const keys = [];
  if (document.getElementById('reportar-bug')?.checked)  keys.push(APP_CONFIG.projects.bug);
  if (document.getElementById('reportar-tech')?.checked) keys.push(APP_CONFIG.projects.tech);
  return keys;
}

// Muestra/oculta el panel según haya algún reporte activo y carga los usuarios.
async function toggleBgAssignee() {
  const wrap = document.getElementById('bg-assignee-wrap');
  const proyectos = _proyectosReporteActivos();
  if (!proyectos.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  await loadAssignableUsers(proyectos);
}

// Usuarios asignables a TODOS los proyectos activos (intersección).
// Si BG y TECH están marcados, sólo lista quien pueda ser asignado en ambos.
let _assigneeKey = '';
async function loadAssignableUsers(proyectos) {
  const key = proyectos.slice().sort().join(',');
  if (key === _assigneeKey) return;   // ya cargado para esta combinación
  const sel  = document.getElementById('bg-asignado');
  const prev = sel.value;
  sel.innerHTML = '<option value="">Cargando…</option>';
  try {
    const r = await fetch(`${JIRA_BASE}/rest/api/3/user/assignable/multiProjectSearch?projectKeys=${key}&maxResults=50`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const users = await r.json();
    if (!Array.isArray(users) || users.length === 0) throw new Error('Sin usuarios');
    sel.innerHTML = '<option value="">Sin asignar</option>' +
      users.map(u => `<option value="${u.accountId}">${u.displayName}</option>`).join('');
    if (Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
    _assigneeKey = key;
  } catch(e) {
    console.error('[assignees]', e.message);
    sel.innerHTML = '<option value="">Sin asignar</option>';
    _assigneeKey = '';
  }
}

// ── Creación de issue de reporte (genérico) ───────────────────────────────────
/**
 * Crea un issue de reporte y lo vincula al issue QAA si se provee linkIssueKey.
 * @returns {{ key: string, url: string }}
 */
async function _crearReporteIssue({ projectKey, issuetype, heading, tcId, desc, moduloNombre, moduloLabel, versionActual, severidad, sevLbl, entorno, steps, precon, esperado, obtenido, impacto, soluciones, linkIssueKey }) {
  const sevSuffix  = (severidad || 'severity-medio').replace(/^severity-/, '');
  const prioridad  = { critico:'Highest', mayor:'High', medio:'Medium', menor:'Low', bajo:'Low' }[sevSuffix] || 'Medium';
  const panelType  = { critico:'error', mayor:'warning', medio:'note', menor:'info', bajo:'info' }[sevSuffix] || 'warning';
  const asignadoId = document.getElementById('bg-asignado').value;

  const description = { type:'doc', version:1, content:[
    mkPanel(panelType, [
      mkH(heading),
    ]),
    mkTable([
      _mkLinkedRow('Test Case', tcId,            `${_BG_JIRA}/browse/${tcId}`),
      _mkLinkedRow('Módulo',    moduloNombre,    `${_BG_JIRA}/browse/${moduloNombre}`),
      _mkLinkedRow('Versión',   versionActual || '—', versionActual ? `${_BG_JIRA}/projects/${APP_CONFIG.projects.qa}?selectedItem=com.atlassian.jira.jira-projects-plugin%3Arelease-page` : null),
      mkTableRow('Severidad',   sevLbl),
      mkTableRow('Entorno',     entorno || '—'),
    ]),
    mkRule(),
    ...(steps.length > 0 || precon.length > 0 ? [mkH('Pasos para reproducir'), mkOrderedList(steps.length > 0 ? steps : precon)] : []),
    ...(esperado.length > 0 ? [mkH('Resultado esperado'),  mkOrderedList(esperado)] : []),
    ...(obtenido.length > 0 ? [mkH('Resultado obtenido'),  mkOrderedList(obtenido)] : []),
    ...(impacto ? [mkPanel('warning', [mkH('Impacto'), mkP(impacto)])] : []),
    ...(soluciones.length > 0 ? [mkH('Solución propuesta'), mkBulletList(soluciones)] : []),
  ]};

  const res = await fetch(`/jira/rest/api/3/issue`, {
    method:  'POST',
    headers: { 'Authorization': AUTH, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ fields: {
      project:     { key: projectKey },
      summary:     `${tcId} — ${desc}`,
      description,
      issuetype:   { name: issuetype },
      priority:    { name: prioridad },
      labels:      [ `severity-${sevSuffix}`, ...moduloLabel.split('+').map(s => s.trim()).filter(Boolean), 'qa-reported', ...(versionActual ? [versionActual] : []) ],
      ...(asignadoId ? { assignee: { accountId: asignadoId } } : {}),
    }})
  });

  if (!res.ok) {
    const e = await res.json();
    throw new Error(`${projectKey}: ${e.errors ? Object.values(e.errors).join(', ') : JSON.stringify(e)}`);
  }

  const issue = await res.json();
  const key   = issue.key;
  const url   = `${_BG_JIRA}/browse/${key}`;

  if (linkIssueKey) {
    const lr = await fetch(`/jira/rest/api/3/issueLink`, {
      method:  'POST',
      headers: { 'Authorization': AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: { name:'Relates' }, inwardIssue: { key: linkIssueKey }, outwardIssue: { key } })
    });
    if (!lr.ok) {
      await fetch(`/jira/rest/api/3/issue/${key}`, { method: 'DELETE', headers: { 'Authorization': AUTH } });
      throw new Error(`Error vinculando ${key} con ${linkIssueKey} — ${key} eliminado`);
    }
  }

  return { key, url };
}

/** Crea un bug en BG. El issuetype sigue al tipo de la actividad QAA. */
async function crearBugBG(opts) {
  return _crearReporteIssue({ ...opts, projectKey: APP_CONFIG.projects.bug, issuetype: opts.tipo || 'Tarea', heading: 'Reporte de Bug' });
}

/** Crea una tarea en SP (LPV Tech). El issuetype se elige en el selector "Tipo SP". */
async function crearTechSP(opts) {
  return _crearReporteIssue({ ...opts, projectKey: APP_CONFIG.projects.tech, issuetype: opts.tipo || 'Tech Task', heading: 'Tarea técnica' });
}
