/**
 * bulk-epic.js — Generación masiva de Test Cases faltantes por Epic
 *
 * Filtro idéntico al missing-panel de history.html:
 *   - Para cada Epic con QA_STRUCTURE en su descripción
 *   - Cruza testCases configurados contra issues ya ejecutados (parent = epic)
 *   - Muestra los TCs faltantes (los configurados que NO tienen issue todavía)
 *
 * Al "Completar" genera cada TC faltante como issue de QAA con la misma
 * estructura ADF que Qa_form.html (tabla, panel resultado, listas), usando
 * el texto del campo bulk como "Resultado obtenido".
 *
 * Depende de globales en bg_verificacion.html:
 *   - JIRA_BASE, esc, _parseJiraError, versionActual
 *   - Helpers ADF: mkH, mkP, mkRule (los demás se definen acá si no existen)
 */

// ── Helpers ADF (algunos ya están globales en bg_verificacion.html) ─────────
function _mkB(text)     { return { type:'paragraph', content:[{type:'text',text,marks:[{type:'strong'}]}] }; }
function _mkPanel(panelType, content) { return { type:'panel', attrs:{panelType}, content }; }
function _mkOrderedList(items) {
  const safe = (items || []).filter(i => i != null && String(i).trim() !== '');
  if (!safe.length) return mkP('—');
  return { type:'orderedList', content: safe.map(i => ({
    type:'listItem', content:[{type:'paragraph', content:[{type:'text',text:String(i)}]}]
  }))};
}
function _mkTableCell(text, isHeader=false) {
  return { type:isHeader?'tableHeader':'tableCell', attrs:{}, content:[{type:'paragraph',content:[{type:'text',text:String(text||'—')}]}] };
}
function _mkTableRow(label, value) {
  return { type:'tableRow', content:[_mkTableCell(label,true), _mkTableCell(String(value||'—'))] };
}
function _mkTable(rows) {
  return { type:'table', attrs:{isNumberColumnEnabled:false, layout:'default'}, content:rows };
}

// ── Helpers de links clickeables en ADF ───────────────────────────────────
const _JIRA_BROWSE = 'https://liceopinoverde.atlassian.net/browse/';
const _JIRA_VERSIONS = 'https://liceopinoverde.atlassian.net/jira/software/projects/QAA/releases';

function _esJiraKey(s)   { return /^[A-Z]+-\d+$/.test(String(s || '').trim()); }
function _esUrl(s)       { return /^https?:\/\//i.test(String(s || '').trim()); }

function _mkLinkText(text, href) {
  return { type:'text', text:String(text), marks:[{ type:'link', attrs:{ href } }] };
}
function _mkTableCellLink(text, href) {
  return { type:'tableCell', attrs:{}, content:[{ type:'paragraph', content:[_mkLinkText(text, href)] }] };
}
function _mkTableRowLink(label, value, href) {
  return { type:'tableRow', content:[_mkTableCell(label, true), _mkTableCellLink(value, href)] };
}
// Row inteligente: detecta si el valor es Jira key, URL, o texto plano
function _mkTableRowSmart(label, value) {
  const v = String(value || '').trim();
  if (!v) return _mkTableRow(label, '—');
  if (_esJiraKey(v)) return _mkTableRowLink(label, v, _JIRA_BROWSE + v);
  if (_esUrl(v))     return _mkTableRowLink(label, v, v);
  return _mkTableRow(label, v);
}

function _extraerTextoDeADF(adf) {
  if (typeof adf === 'string') return adf;
  if (!adf?.content) return '';
  let texto = '';
  function procesar(nodo) {
    if (!nodo) return;
    if (nodo.type === 'codeBlock') {
      if (nodo.content) nodo.content.forEach(h => { if (h.text) texto += h.text; });
      texto += '\n';
      return;
    }
    if (nodo.text) texto += nodo.text;
    if (nodo.content) nodo.content.forEach(procesar);
    if (['paragraph','heading','listItem'].includes(nodo.type)) texto += '\n';
  }
  adf.content.forEach(procesar);
  return texto;
}

function _extractTCTitle(summary) {
  let s = (summary || '').trim();
  const idx = s.indexOf(' — ');
  if (idx !== -1) return s.slice(idx + 3).trim().toLowerCase();
  s = s.replace(/^[⚙️\u{1f501}\u{1f504}\s]+/gu, '');
  s = s.replace(/^[A-Za-z]{1,4}-\d+\s*/i, '');
  return s.trim().toLowerCase();
}

const _estructuraCache = {};
async function _cargarEstructuraEpic(epicKey) {
  if (_estructuraCache[epicKey]) return _estructuraCache[epicKey];
  const r = await fetch(`${JIRA_BASE}/rest/api/3/issue/${epicKey}?fields=description`, {
    headers: { Accept: 'application/json' }
  });
  if (!r.ok) return null;
  const data = await r.json();
  const texto = _extraerTextoDeADF(data.fields?.description);
  const iStart = texto.indexOf('QA_STRUCTURE_START');
  const iEnd   = texto.lastIndexOf('QA_STRUCTURE_END');
  if (iStart === -1 || iEnd === -1) return null;
  const between   = texto.slice(iStart + 18, iEnd);
  const jsonMatch = between.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const estructura = JSON.parse(jsonMatch[0]);
    _estructuraCache[epicKey] = estructura;
    return estructura;
  } catch { return null; }
}

// ── Estado ───────────────────────────────────────────────────────────────────
const bulkState = {
  cargado:        false,
  epics:          [],     // [{ key, name, prefix, modulo, missing: [tc...], nextNumero }]
  selectedEpic:   null,
  resultado:      'pasa',
  prioridad:      'Medium',
  texto:          '',
  imagenes:       [],     // File[]
  finalizar:      false,  // FN QAA: transicionar a Finalizada al crear
  submitting:     false
};

// ── Carga + cómputo de TCs faltantes por Epic ───────────────────────────────
async function cargarBulkEpics() {
  const listEl = document.getElementById('bulk-epic-list');
  if (!listEl) return;
  listEl.innerHTML = '<div style="padding:20px;color:var(--sub);font-size:12px;text-align:center;">Cargando epics + cobertura...</div>';

  try {
    const epicJql = encodeURIComponent('project = QAA AND issuetype = Epic ORDER BY created ASC');
    const rE = await fetch(`${JIRA_BASE}/rest/api/3/search/jql?jql=${epicJql}&fields=summary&maxResults=100`, {
      headers: { Accept: 'application/json' }
    });
    if (!rE.ok) throw new Error(`HTTP ${rE.status} cargando epics`);
    const dataE = await rE.json();
    const epicsRaw = (dataE.issues || []).map(i => ({ key: i.key, name: i.fields?.summary || i.key }));

    // Para cada epic: cargar estructura, contar ejecutados, calcular missing
    const epics = [];
    for (const e of epicsRaw) {
      const estructura = await _cargarEstructuraEpic(e.key);
      if (!estructura?.testCases?.length) continue;

      // Issues ejecutados en este epic
      let executedTitles = new Set();
      let totalEjecuciones = 0;
      try {
        const jql = encodeURIComponent(`parent = "${e.key}"${versionActual ? ` AND fixVersion = "${versionActual}"` : ''}`);
        const rI = await fetch(`${JIRA_BASE}/rest/api/3/search/jql?jql=${jql}&fields=summary&maxResults=200`, {
          headers: { Accept: 'application/json' }
        });
        if (rI.ok) {
          const dataI = await rI.json();
          executedTitles = new Set((dataI.issues || []).map(i => _extractTCTitle(i.fields?.summary || '')));
          totalEjecuciones = (dataI.issues || []).length;
        }
      } catch {}

      const missing = estructura.testCases.filter(tc => !executedTitles.has((tc.titulo || '').toLowerCase()));

      // Próximo numero (para el ID secuencial) — necesita TOTAL sin filtro de versión
      let nextNumero = totalEjecuciones + 1;
      try {
        const jqlTotal = encodeURIComponent(`parent = "${e.key}"`);
        const rTotal = await fetch(`${JIRA_BASE}/rest/api/3/search/jql?jql=${jqlTotal}&fields=key&maxResults=200`, {
          headers: { Accept: 'application/json' }
        });
        if (rTotal.ok) {
          const dT = await rTotal.json();
          nextNumero = (dT.issues || []).length + 1;
        }
      } catch {}

      epics.push({
        key:        e.key,
        name:       e.name,
        prefix:     estructura.meta?.prefix || e.key.replace(/-\d+$/, '') || 'TC',
        modulo:     estructura.meta?.moduloSistema || '',
        estructura,
        missing,
        nextNumero
      });
    }

    epics.sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name));
    bulkState.epics = epics;
    bulkState.cargado = true;
    renderBulkEpicList();
  } catch (e) {
    console.error('[bulk] error cargando:', e);
    listEl.innerHTML = `<div style="padding:20px;color:var(--red);font-size:12px;">Error: ${esc(e.message)}</div>`;
  }
}

function renderBulkEpicList() {
  const listEl = document.getElementById('bulk-epic-list');
  if (!listEl) return;
  if (!bulkState.epics.length) {
    listEl.innerHTML = '<div style="padding:20px;color:var(--sub);font-size:12px;text-align:center;">Ningún Epic tiene QA_STRUCTURE configurado</div>';
    return;
  }
  listEl.innerHTML = bulkState.epics.map(e => {
    const isSel = e.key === bulkState.selectedEpic;
    const count = e.missing.length;
    const zero  = count === 0 ? ' zero' : '';
    return `
      <div class="bulk-epic-item${isSel ? ' selected' : ''}" onclick="seleccionarBulkEpic('${esc(e.key)}')">
        <span class="bulk-epic-item-key">${esc(e.key)}</span>
        <span class="bulk-epic-item-name">${esc(e.name)}</span>
        <span class="bulk-epic-item-count${zero}">${count} faltante${count !== 1 ? 's' : ''}</span>
      </div>`;
  }).join('');
}

function seleccionarBulkEpic(key) {
  bulkState.selectedEpic = key;
  bulkState.resultado    = 'pasa';
  bulkState.texto        = '';
  bulkState.imagenes     = [];
  renderBulkEpicList();
  renderBulkDetail();
}

function renderBulkDetail() {
  const det = document.getElementById('bulk-detail');
  if (!det) return;
  const epic = bulkState.epics.find(e => e.key === bulkState.selectedEpic);
  if (!epic) {
    det.innerHTML = `
      <div class="bulk-detail-empty">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
          <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
        </svg>
        <div>Seleccioná un Epic de la izquierda para ver los TCs faltantes</div>
      </div>`;
    return;
  }

  const tasks = epic.missing;
  const tasksHtml = tasks.length
    ? tasks.map(tc => `
        <div class="bulk-task-row">
          <span class="badge-key">${esc(tc.id)}</span>
          <span class="bulk-task-summary" title="${esc(tc.titulo)}">${esc(tc.titulo)}</span>
        </div>`).join('')
    : '<div style="padding:18px;text-align:center;color:var(--sub);font-size:12px;">Sin TCs faltantes en este Epic 🎉</div>';

  const filesHtml = bulkState.imagenes.map((f, idx) => `
    <div class="bulk-file-row">
      <span class="bulk-file-name" title="${esc(f.name)}">${esc(f.name)}</span>
      <button class="bulk-file-remove" onclick="quitarImagenBulk(${idx})" title="Quitar">×</button>
    </div>`).join('');

  const vBadge = versionActual ? ` · fixVersion <strong>${esc(versionActual)}</strong>` : '';

  det.innerHTML = `
    <div class="bulk-detail-header">
      <div style="flex:1">
        <div class="bulk-detail-title">${esc(epic.name)}</div>
        <div class="bulk-detail-sub">
          <a href="https://liceopinoverde.atlassian.net/browse/${esc(epic.key)}" target="_blank" rel="noopener noreferrer" style="color:var(--sub);text-decoration:underline;">${esc(epic.key)}</a>
          · ${tasks.length} TC${tasks.length !== 1 ? 's' : ''} sin ejecutar${vBadge}
        </div>
      </div>
    </div>

    <div class="bulk-task-list">${tasksHtml}</div>

    <div class="bulk-form-group">
      <label class="bulk-form-label">Resultado a aplicar a TODOS</label>
      <div class="bulk-radio-row">
        <label class="bulk-radio pasa ${bulkState.resultado === 'pasa' ? 'selected' : ''}">
          <input type="radio" name="bulk-res" value="pasa" ${bulkState.resultado === 'pasa' ? 'checked' : ''} onchange="setBulkResultado('pasa')" style="display:none;">
          ✓ Pasa
        </label>
        <label class="bulk-radio falla ${bulkState.resultado === 'falla' ? 'selected' : ''}">
          <input type="radio" name="bulk-res" value="falla" ${bulkState.resultado === 'falla' ? 'checked' : ''} onchange="setBulkResultado('falla')" style="display:none;">
          ✗ Falla
        </label>
      </div>
    </div>

    <div class="bulk-form-group">
      <label class="bulk-form-label">Prioridad (para TODOS los TCs)</label>
      <select class="bulk-textarea" id="bulk-prioridad" onchange="setBulkPrioridad(this.value)" style="min-height:0;padding:8px 10px;cursor:pointer">
        <option value="Medium"  ${bulkState.prioridad === 'Medium'  ? 'selected' : ''}>Medium</option>
        <option value="Highest" ${bulkState.prioridad === 'Highest' ? 'selected' : ''}>Highest — Crítico</option>
        <option value="High"    ${bulkState.prioridad === 'High'    ? 'selected' : ''}>High — Alto</option>
        <option value="Low"     ${bulkState.prioridad === 'Low'     ? 'selected' : ''}>Low — Bajo</option>
        <option value="Lowest"  ${bulkState.prioridad === 'Lowest'  ? 'selected' : ''}>Lowest — Mínimo</option>
      </select>
    </div>

    <div class="bulk-form-group">
      <label class="bulk-form-label">Resultados obtenidos (se agrega a TODOS)</label>
      <textarea class="bulk-textarea" id="bulk-textarea" placeholder="Ej: Comportamiento OK en navegador y mobile. Validaciones funcionando correctamente." oninput="bulkState.texto = this.value">${esc(bulkState.texto)}</textarea>
    </div>

    <div class="bulk-form-group">
      <label class="bulk-form-label">Imágenes (se suben a TODOS)</label>
      <input type="file" id="bulk-files" accept="image/*" multiple onchange="agregarImagenesBulk(event)" style="margin-bottom:8px;font-size:12px;">
      <div class="bulk-files">${filesHtml}</div>
    </div>

    <div class="bulk-actions">
      <span class="bulk-progress" id="bulk-progress"></span>
      <label class="checkbox-label" title="Transicionar cada TC a Finalizada después de crearlo">
        <input type="checkbox" id="bulk-finalizar-qaa" ${bulkState.finalizar ? 'checked' : ''} onchange="setBulkFinalizar(this.checked)">
        FN QAA
      </label>
      <button class="bulk-btn-complete" id="bulk-btn-complete" onclick="completarBulk()" ${tasks.length === 0 || bulkState.submitting ? 'disabled' : ''}>
        ${bulkState.submitting ? 'Procesando...' : `Generar ${tasks.length} TC${tasks.length !== 1 ? 's' : ''}`}
      </button>
    </div>`;
}

function setBulkResultado(r) {
  bulkState.resultado = r;
  renderBulkDetail();
}

function setBulkFinalizar(checked) {
  bulkState.finalizar = !!checked;
}

function setBulkPrioridad(p) {
  bulkState.prioridad = p || 'Medium';
}

function agregarImagenesBulk(e) {
  const files = Array.from(e.target.files || []);
  bulkState.imagenes.push(...files);
  renderBulkDetail();
}

function quitarImagenBulk(idx) {
  bulkState.imagenes.splice(idx, 1);
  renderBulkDetail();
}

// ── Construye la descripción ADF idéntica a Qa_form.html ───────────────────
function _buildTCDescription(tc, epic, resultado, textoObtenido) {
  const obtenidoLines = (textoObtenido || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!obtenidoLines.length) obtenidoLines.push(resultado === 'pasa' ? 'Comportamiento correcto' : 'Comportamiento incorrecto');

  const esperadoRaw = tc.resultadoEsperado;
  const esperado    = esperadoRaw ? (Array.isArray(esperadoRaw) ? esperadoRaw : [esperadoRaw]) : [];

  const fecha    = new Date().toISOString().slice(0, 10);
  const tipoLbl  = (tc.tipoTest || 'funcional').replace(/^type-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const entorno  = `${tc.navegador || '—'} / ${tc.sistemaOp || '—'}${versionActual ? ' / ' + versionActual : ''}`;

  const moduloDisp = epic.modulo || epic.name;

  return { type:'doc', version:1, content:[
    _mkPanel('info', [ mkH('Identificación del Test Case') ]),
    _mkTable([
      _mkTableRow('Identificador', tc.id),
      _mkTableRow('Tester',        'QA Bulk'),
      _mkTableRow('Fecha',         fecha),
      _mkTableRowLink('Módulo',    `${moduloDisp} (${epic.key})`, _JIRA_BROWSE + epic.key),
      _mkTableRow('Tipo',          tipoLbl),
      _mkTableRow('Entorno',       entorno),
      ...(tc.urlPantalla ? [_mkTableRowSmart('URL / Pantalla', tc.urlPantalla)] : []),
      ...(tc.rolUsuario  ? [_mkTableRow('Rol de usuario', tc.rolUsuario)] : []),
      ...(tc.historia    ? [_mkTableRowSmart('Historia',   tc.historia)]  : []),
      ...(versionActual  ? [_mkTableRowLink('Versión', versionActual, _JIRA_VERSIONS)] : []),
    ]),
    mkRule(),
    mkH('Precondiciones'),     _mkOrderedList(tc.precondiciones || []),
    mkH('Datos de entrada'),   _mkOrderedList(tc.datos || []),
    mkH('Pasos a seguir'),     _mkOrderedList(tc.pasos || []),
    mkH('Resultado esperado'), _mkOrderedList(esperado),
    mkH('Resultado obtenido'), _mkOrderedList(obtenidoLines),
    ...(tc.postcondiciones?.length ? [mkH('Postcondiciones'), _mkOrderedList(tc.postcondiciones)] : []),
  ]};
}

// ── Genera un issue QAA por cada TC faltante, devuelve { key, ok, err } ────
async function _generarTC(tc, epic, resultado, textoObtenido, numero) {
  const estado     = resultado === 'pasa' ? 'pass' : 'fail';
  const tipoTest   = tc.tipoTest && tc.tipoTest.startsWith('type-') ? tc.tipoTest : `type-${tc.tipoTest || 'funcional'}`;
  const moduloLbl  = epic.modulo || '';
  const moduloLabels = moduloLbl
    ? moduloLbl.split('+').map(s => s.trim()).filter(Boolean)
    : [];

  const labels = [
    `estado-${estado}`,
    tipoTest,
    ...moduloLabels,
    ...(versionActual ? [versionActual] : []),
  ];

  const summary = `${tc.id} — ${tc.titulo}`;
  const description = _buildTCDescription(tc, epic, resultado, textoObtenido);

  const payload = {
    fields: {
      project:           { key: 'QAA' },
      parent:            { key: epic.key },
      customfield_10014: epic.key,
      summary,
      issuetype:         { name: 'Tarea' },
      priority:          { name: bulkState.prioridad || 'Medium' },
      labels,
      description,
      ...(versionActual ? { fixVersions: [{ name: versionActual }] } : {})
    }
  };

  const r = await fetch(`${JIRA_BASE}/rest/api/3/issue`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify(payload)
  });
  if (!r.ok) {
    const errBody = await r.text();
    throw new Error(_parseJiraError(errBody, r.status));
  }
  const created = await r.json();
  return created.key;
}

async function _subirAdjuntosA(taskKey, files) {
  for (const file of files) {
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      await fetch(`${JIRA_BASE}/rest/api/3/issue/${taskKey}/attachments`, {
        method:  'POST',
        headers: { 'X-Atlassian-Token': 'no-check' },
        body:    fd
      });
    } catch {}
  }
}

async function _transicionarADone(taskKey) {
  const tRes = await fetch(`${JIRA_BASE}/rest/api/3/issue/${taskKey}/transitions`, {
    headers: { Accept: 'application/json' }
  });
  if (!tRes.ok) return false;
  const transitions = (await tRes.json()).transitions || [];
  const target = transitions.find(tr => /done|terminad|finaliz|listo|cerrad|resuelto|complete|finish/i.test(tr.name))
              || transitions.find(tr => tr.to?.statusCategory?.key === 'done');
  if (!target) return false;
  const pRes = await fetch(`${JIRA_BASE}/rest/api/3/issue/${taskKey}/transitions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify({ transition: { id: target.id } })
  });
  return pRes.ok;
}

async function completarBulk() {
  if (bulkState.submitting) return;
  const epic = bulkState.epics.find(e => e.key === bulkState.selectedEpic);
  if (!epic) return;
  const tasks = epic.missing;
  if (!tasks.length) return;

  const ta = document.getElementById('bulk-textarea');
  if (ta) bulkState.texto = ta.value;
  const chk = document.getElementById('bulk-finalizar-qaa');
  if (chk) bulkState.finalizar = chk.checked;
  const sel = document.getElementById('bulk-prioridad');
  if (sel) bulkState.prioridad = sel.value;
  const finalizar = bulkState.finalizar;

  bulkState.submitting = true;
  renderBulkDetail();

  const banner = document.getElementById('bulk-banner');
  if (banner) banner.className = 'summary-banner';
  const prog = () => document.getElementById('bulk-progress');

  const creados = [];   // [{ tcId, key }]
  const fallidos = [];  // [{ tcId, err }]

  for (let i = 0; i < tasks.length; i++) {
    const tc = tasks[i];
    if (prog()) prog().textContent = `${i + 1}/${tasks.length} generando ${esc(tc.id)}...`;
    try {
      const newKey = await _generarTC(tc, epic, bulkState.resultado, bulkState.texto, epic.nextNumero + i);
      if (bulkState.imagenes.length) await _subirAdjuntosA(newKey, bulkState.imagenes);
      if (finalizar) await _transicionarADone(newKey);
      creados.push({ tcId: tc.id, key: newKey });
    } catch (e) {
      console.error(`[bulk] ${tc.id} error:`, e);
      fallidos.push({ tcId: tc.id, err: e.message || String(e) });
    }
  }

  if (prog()) prog().textContent = '';
  bulkState.submitting = false;

  if (banner) {
    const ok = creados.length, fail = fallidos.length;
    const partes = [];
    if (ok)   partes.push(`${ok} generado${ok !== 1 ? 's' : ''}${finalizar ? ' + FN QAA' : ''}`);
    if (fail) partes.push(`${fail} fallido${fail !== 1 ? 's' : ''}`);

    const linksHtml = creados.length
      ? `<div style="margin-top:8px;font-size:11px;line-height:1.7">` +
          creados.map(c =>
            `<a href="https://liceopinoverde.atlassian.net/browse/${esc(c.key)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;font-weight:700;margin-right:8px" title="Abrir ${esc(c.key)} en Jira">${esc(c.tcId)} → ${esc(c.key)}</a>`
          ).join('') +
        `</div>`
      : '';

    const failsHtml = fallidos.length
      ? `<div style="margin-top:6px;font-size:11px;opacity:.85">` +
          fallidos.map(f => `<span style="margin-right:10px"><strong>${esc(f.tcId)}</strong>: ${esc(f.err)}</span>`).join('') +
        `</div>`
      : '';

    banner.className = fail === 0 ? 'summary-banner show ok' : 'summary-banner show warn';
    banner.innerHTML = `<div><strong>${partes.join(' · ')}</strong> en ${esc(epic.name)}.</div>${linksHtml}${failsHtml}`;
  }

  await cargarBulkEpics();
  if (bulkState.epics.find(e => e.key === epic.key)) {
    bulkState.selectedEpic = epic.key;
  } else {
    bulkState.selectedEpic = null;
  }
  renderBulkEpicList();
  renderBulkDetail();
}
