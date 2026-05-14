/**
 * bg_reporter.js
 * Crea bugs en el proyecto BG (reportador de errores).
 * Depende de las globales: AUTH, JIRA_BASE, mkB, mkH, mkP, mkRule, mkOrderedList
 */

let bgUsersLoaded = false;

const _BG_JIRA = 'https://liceopinoverde.atlassian.net';

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

async function toggleBgAssignee(chk) {
  const wrap = document.getElementById('bg-assignee-wrap');
  if (!chk.checked) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  if (bgUsersLoaded) return;
  const sel = document.getElementById('bg-asignado');
  sel.innerHTML = '<option value="">Cargando…</option>';
  try {
    const r = await fetch(`${JIRA_BASE}/rest/api/3/user/assignable/search?project=BG&maxResults=50`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const users = await r.json();
    if (!Array.isArray(users) || users.length === 0) throw new Error('Sin usuarios');
    sel.innerHTML = '<option value="">Sin asignar</option>' +
      users.map(u => `<option value="${u.accountId}">${u.displayName}</option>`).join('');
    bgUsersLoaded = true;
  } catch(e) {
    console.error('[BG assignees]', e.message);
    sel.innerHTML = '<option value="">Sin asignar</option>';
  }
}

/**
 * Crea una tarea en BG y la vincula al issue QAA si se provee linkIssueKey.
 * @returns {{ key: string, url: string }}
 */
async function crearBugBG({ tcId, desc, moduloNombre, moduloLabel, versionActual, severidad, sevLbl, entorno, steps, precon, esperado, obtenido, impacto, soluciones, linkIssueKey }) {
  const sevSuffix    = severidad.replace(/^severity-/, '');
  const prioridadBug = { critico:'Highest', mayor:'High', medio:'Medium', menor:'Low', bajo:'Low' }[sevSuffix] || 'Medium';
  const bgAsignadoId = document.getElementById('bg-asignado').value;

  const bugPanelType = { critico:'error', mayor:'warning', medio:'note', menor:'info', bajo:'info' }[sevSuffix] || 'warning';

  const bgDescription = { type:'doc', version:1, content:[
    mkPanel(bugPanelType, [
      mkH('Reporte de Bug'),
    ]),
    mkTable([
      _mkLinkedRow('Test Case', tcId,            `${_BG_JIRA}/browse/${tcId}`),
      _mkLinkedRow('Módulo',    moduloNombre,    `${_BG_JIRA}/browse/${moduloNombre}`),
      _mkLinkedRow('Versión',   versionActual || '—', versionActual ? `${_BG_JIRA}/projects/QAA?selectedItem=com.atlassian.jira.jira-projects-plugin%3Arelease-page` : null),
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

  const bugRes = await fetch(`/jira/rest/api/3/issue`, {
    method:  'POST',
    headers: { 'Authorization': AUTH, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ fields: {
      project:     { key: 'BG' },
      summary:     `${tcId} — ${desc}`,
      description: bgDescription,
      issuetype:   { name: 'Tarea' },
      priority:    { name: prioridadBug },
      labels:      [ `severity-${sevSuffix}`, ...moduloLabel.split('+').map(s => s.trim()).filter(Boolean), 'qa-reported', ...(versionActual ? [versionActual] : []) ],
      ...(bgAsignadoId ? { assignee: { accountId: bgAsignadoId } } : {}),
    }})
  });

  if (!bugRes.ok) {
    const e = await bugRes.json();
    throw new Error(`BG: ${e.errors ? Object.values(e.errors).join(', ') : JSON.stringify(e)}`);
  }

  const bug    = await bugRes.json();
  const bugKey = bug.key;
  const bugUrl = `https://liceopinoverde.atlassian.net/browse/${bugKey}`;

  if (linkIssueKey) {
    const lr = await fetch(`/jira/rest/api/3/issueLink`, {
      method:  'POST',
      headers: { 'Authorization': AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: { name:'Relates' }, inwardIssue: { key: linkIssueKey }, outwardIssue: { key: bugKey } })
    });
    if (!lr.ok) {
      await fetch(`/jira/rest/api/3/issue/${bugKey}`, { method: 'DELETE', headers: { 'Authorization': AUTH } });
      throw new Error(`Error vinculando ${bugKey} con ${linkIssueKey} — ${bugKey} eliminado`);
    }
  }

  return { key: bugKey, url: bugUrl };
}
