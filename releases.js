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

// ── Confluence ────────────────────────────────────────────────────────────────

async function obtenerDatosVersion(nombreVersion) {
  const jql = encodeURIComponent(`project = QAA AND fixVersion = "${nombreVersion}" AND issuetype != Epic`);
  const r   = await fetch(`/jira/rest/api/3/search/jql?jql=${jql}&fields=labels,summary,key&maxResults=200`, {
    headers: { 'Authorization': AUTH, 'Accept': 'application/json' }
  });
  const d      = await r.json();
  const issues = d.issues || [];

  const configIssues = issues.filter(i => (i.fields.labels||[]).includes('requiere-config'));
  const failIssues   = issues.filter(i => (i.fields.labels||[]).includes('estado-fail'));
  const retestIssues = issues.filter(i => (i.fields.labels||[]).includes('retest'));

  return {
    stats: {
      total:   issues.length,
      pass:    issues.filter(i => (i.fields.labels||[]).includes('estado-pass')).length,
      fail:    failIssues.length,
      blocked: issues.filter(i => (i.fields.labels||[]).includes('estado-blocked')).length,
      retest:  retestIssues.length,
    },
    requiereConfig: configIssues.length > 0,
    pasosConfig:    configIssues.map(i => ({ key: i.key, summary: i.fields.summary })),
    bugsFijos:      failIssues.map(i => i.key),
    retestIssues:   retestIssues.map(i => ({ key: i.key, summary: i.fields.summary })),
  };
}

async function agregarAlHistorialConfluence({ version, motivo, requiereConfig, pasosConfig, bugsFijos, retestIssues, stats, observaciones }) {
  const fecha   = new Date().toLocaleDateString('es-CO');
  const tasa    = stats.total > 0 ? `${Math.round((stats.pass / stats.total) * 100)}%` : '—';
  const WIKI_V1 = window.location.origin + '/wiki/rest/api';

  const JIRA_UI = 'https://liceopinoverde.atlassian.net';
  const baseJql = `project = QAA AND fixVersion = "${version}" AND issuetype != Epic`;
  const jqlUrl  = extra => `${JIRA_UI}/issues/?jql=${encodeURIComponent(extra ? baseJql + ' AND ' + extra : baseJql)}`;

  const resPage = await fetch(`${WIKI_V1}/content/${HISTORIAL_PAGE_ID}?expand=body.storage,version`, {
    headers: { 'Accept': 'application/json' }
  });
  if (!resPage.ok) throw new Error(`Confluence GET: HTTP ${resPage.status}`);
  const page    = await resPage.json();
  const verNum  = page.version.number;
  const current = page.body?.storage?.value || '';

  const jiraLink = key => `<a href="https://liceopinoverde.atlassian.net/browse/${key}">${key}</a>`;

  const configBloque = requiereConfig && pasosConfig.length
    ? `<ac:structured-macro ac:name="note"><ac:parameter ac:name="title">⚙️ Requiere configuración</ac:parameter><ac:rich-text-body><ol>${pasosConfig.map(p=>`<li>${jiraLink(p.key)}: ${p.summary}</li>`).join('')}</ol></ac:rich-text-body></ac:structured-macro>`
    : `<ac:structured-macro ac:name="tip"><ac:parameter ac:name="title"> Sin cambios de configuración</ac:parameter><ac:rich-text-body><p>El servidor no requiere cambios adicionales.</p></ac:rich-text-body></ac:structured-macro>`;

  const bugsBloque = bugsFijos.length
    ? `<p><strong>Bugs corregidos:</strong> ${bugsFijos.map(b => jiraLink(b)).join(', ')}</p>`
    : '';

  const retestBloque = (retestIssues||[]).length
    ? `<ac:structured-macro ac:name="info"><ac:parameter ac:name="title"> Re-tests ejecutados</ac:parameter><ac:rich-text-body><ol>${retestIssues.map(r=>`<li>${jiraLink(r.key)}: ${r.summary}</li>`).join('')}</ol></ac:rich-text-body></ac:structured-macro>`
    : '';

  const notasBloque = observaciones ? `<p><strong>Observaciones:</strong> ${observaciones}</p>` : '';

  const entrada = `<h2>${version} — ${fecha}</h2>
<table><tbody>
  <tr><th>Versión</th><th>Fecha</th><th>Total</th><th> Pass</th><th> Fail</th><th> Blocked</th><th> Retest</th><th>Tasa</th></tr>
  <tr><td><strong>${version}</strong></td><td>${fecha}</td><td><a href="${jqlUrl()}">${stats.total}</a></td><td><a href="${jqlUrl('labels = "estado-pass"')}">${stats.pass}</a></td><td><a href="${jqlUrl('labels = "estado-fail"')}">${stats.fail}</a></td><td><a href="${jqlUrl('labels = "estado-blocked"')}">${stats.blocked}</a></td><td><a href="${jqlUrl('labels = "retest"')}">${stats.retest||0}</a></td><td><strong>${tasa}</strong></td></tr>
</tbody></table>
<p><strong>Motivo:</strong> ${motivo}</p>
${configBloque}${retestBloque}${bugsBloque}${notasBloque}<hr/>`;

  // Deduplicar: si ya existe entrada para esta versión, reemplazarla
  const marcaInicio = `<h2>${version} `;
  let nuevoContenido;
  const idxInicio = current.indexOf(marcaInicio);
  if (idxInicio !== -1) {
    // Confluence puede normalizar <hr/> → <hr>, manejamos ambos
    let idxHr = current.indexOf('<hr/>', idxInicio);
    let hrLen = 5;
    if (idxHr === -1) { idxHr = current.indexOf('<hr>', idxInicio); hrLen = 4; }
    const fin = idxHr !== -1 ? idxHr + hrLen : current.length;
    nuevoContenido = current.slice(0, idxInicio) + entrada + current.slice(fin);
  } else {
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

  let datos = { stats:{ total:0,pass:0,fail:0,blocked:0 }, requiereConfig:false, pasosConfig:[], bugsFijos:[] };
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
        <div style="font-size:11px;color:#6d28d9"> Retest</div>
      </div>
      <div style="flex:1;min-width:65px;text-align:center;background:#dbeafe;border-radius:8px;padding:10px">
        <div style="font-size:22px;font-weight:800;color:#2563eb">${tasa}</div>
        <div style="font-size:11px;color:#1d4ed8">Pass rate</div>
      </div>
    </div>

    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--g5);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Fails detectados (auto)</div>
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
    await agregarAlHistorialConfluence({
      version: publicada, motivo,
      requiereConfig: datos.requiereConfig,
      pasosConfig:    datos.pasosConfig,
      bugsFijos:      datos.bugsFijos,
      retestIssues:   datos.retestIssues,
      stats:          datos.stats,
      observaciones
    });

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
