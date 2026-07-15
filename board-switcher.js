/**
 * board-switcher.js — Selector del tablero activo por tipo (Fase 2)
 * Lee window.APP_CONFIG.boards (id/name/projectKey por tipo, sin secretos) y muestra
 * en el header el tablero QA activo + un panel para cambiarlo. Al cambiar, hace
 * POST /setup/active-board y recarga la página para que todas las consultas usen el
 * nuevo tablero. Toda la config sale del JSON — nada hardcodeado.
 * Uso:  BoardSwitcher.init({ container: document.getElementById('board-switcher-container') })
 */

const BoardSwitcher = (() => {
  let _btnEl   = null;
  let _panelEl = null;

  const TYPES = [
    { key: 'qa',   label: 'Test Cases' },
    { key: 'bug',  label: 'Bugs' },
    { key: 'tech', label: 'Tareas técnicas' },
  ];

  // ── Lectura de config ───────────────────────────────────────────────────────

  function _boards()   { return (window.APP_CONFIG && window.APP_CONFIG.boards) || {}; }
  function _branding() { return (window.APP_CONFIG && window.APP_CONFIG.branding) || {}; }

  function _group(type) {
    const g = _boards()[type];
    return (g && Array.isArray(g.items)) ? g : { activeBoardId: '', items: [] };
  }

  function _active(type) {
    const g = _group(type);
    return g.items.find(b => b.id === g.activeBoardId) || g.items[0] || null;
  }

  function _hasAny() {
    return TYPES.some(t => _group(t.key).items.length);
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ── Cambio de tablero ───────────────────────────────────────────────────────

  async function _switch(type, boardId) {
    const g = _group(type);
    if (g.activeBoardId === boardId) { _panelEl.style.display = 'none'; return; }
    try {
      const r = await fetch('/setup/active-board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, boardId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        _flash('No se pudo cambiar el tablero: ' + (d.message || ('HTTP ' + r.status)));
        return;
      }
      // Recargar: /config.js re-resuelve el activo y todas las consultas lo toman.
      location.reload();
    } catch (e) {
      _flash('Error al cambiar el tablero: ' + e.message);
    }
  }

  function _flash(msg) {
    const el = _panelEl.querySelector('.bs-flash');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

  function init({ container } = {}) {
    if (!container || !_hasAny()) return;   // sin tableros configurados → no se muestra
    _injectStyles();

    _btnEl = document.createElement('button');
    _btnEl.className = 'bs-btn';
    _btnEl.title = 'Cambiar tablero activo';
    _renderBtn();
    _btnEl.addEventListener('click', e => { e.stopPropagation(); _togglePanel(); });
    container.appendChild(_btnEl);

    _panelEl = document.createElement('div');
    _panelEl.className = 'bs-panel';
    _panelEl.style.display = 'none';
    document.body.appendChild(_panelEl);

    document.addEventListener('click', e => {
      if (_panelEl.style.display !== 'none' && !_panelEl.contains(e.target) && !_btnEl.contains(e.target)) {
        _panelEl.style.display = 'none';
      }
    });
  }

  function _renderBtn() {
    const qa = _active('qa') || _active('bug') || _active('tech');
    const name = qa ? qa.name : 'Tablero';
    _btnEl.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>' +
      '<rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' +
      '<span class="bs-btn-label">' + _esc(name) + '</span>' +
      '<svg class="bs-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  }

  function _togglePanel() {
    if (_panelEl.style.display === 'none') { _renderPanel(); _positionPanel(); _panelEl.style.display = 'block'; }
    else _panelEl.style.display = 'none';
  }

  function _positionPanel() {
    const rect = _btnEl.getBoundingClientRect();
    _panelEl.style.top   = (rect.bottom + 6 + window.scrollY) + 'px';
    _panelEl.style.right = (window.innerWidth - rect.right) + 'px';
    _panelEl.style.left  = 'auto';
  }

  function _renderPanel() {
    const org = _branding().orgName || '';
    let html = '';
    if (org) html += '<div class="bs-org">' + _esc(org) + '</div>';

    TYPES.forEach(t => {
      const g = _group(t.key);
      if (!g.items.length) return;
      html += '<div class="bs-section-title">' + t.label + '</div><div class="bs-list" data-type="' + t.key + '">';
      g.items.forEach(b => {
        const on = b.id === g.activeBoardId;
        html += '<button class="bs-item' + (on ? ' bs-item-active' : '') + '" data-type="' + t.key + '" data-id="' + _esc(b.id) + '">' +
          '<span class="bs-check">' + (on ? '✓' : '') + '</span>' +
          '<span class="bs-name" title="' + _esc(b.name) + '">' + _esc(b.name) + '</span>' +
          '<span class="bs-key">' + _esc(b.projectKey) + '</span></button>';
      });
      html += '</div>';
    });
    html += '<div class="bs-flash" style="display:none"></div>';
    html += '<div class="bs-foot"><a href="/setup">⚙️ Editar tableros</a></div>';
    _panelEl.innerHTML = html;

    _panelEl.querySelectorAll('.bs-item').forEach(btn => {
      btn.addEventListener('click', () => _switch(btn.dataset.type, btn.dataset.id));
    });
  }

  // ── Estilos ───────────────────────────────────────────────────────────────

  function _injectStyles() {
    if (document.getElementById('bs-styles')) return;
    const s = document.createElement('style');
    s.id = 'bs-styles';
    s.textContent = `
      .bs-btn {
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14);
        color: #e2e8f0; border-radius: 7px; padding: 5px 10px;
        font-size: 12px; font-weight: 600; font-family: inherit;
        cursor: pointer; transition: all .15s; white-space: nowrap; max-width: 220px;
      }
      .bs-btn svg { width: 13px; height: 13px; flex-shrink: 0; }
      .bs-btn .bs-caret { width: 11px; height: 11px; opacity: .7; }
      .bs-btn-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .bs-btn:hover { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.28); }
      .bs-panel {
        position: absolute; z-index: 9000; width: 260px;
        background: #1e293b; border: 1px solid #334155; border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0,0,0,.4); font-family: inherit;
        padding: 6px 0 0; overflow: hidden;
      }
      .bs-org {
        padding: 10px 14px 6px; font-size: 12px; font-weight: 700; color: #f1f5f9;
        border-bottom: 1px solid #334155; margin-bottom: 4px;
      }
      .bs-section-title {
        padding: 8px 14px 4px; font-size: 10px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .06em; color: #64748b;
      }
      .bs-list { display: flex; flex-direction: column; padding: 0 6px 4px; }
      .bs-item {
        display: flex; align-items: center; gap: 8px; width: 100%;
        background: none; border: none; border-radius: 6px; cursor: pointer;
        padding: 7px 8px; font-family: inherit; font-size: 12.5px; color: #cbd5e1;
        text-align: left; transition: background .12s;
      }
      .bs-item:hover { background: #0f172a; }
      .bs-item-active { color: #f1f5f9; }
      .bs-check { width: 14px; color: #34d399; font-weight: 700; flex-shrink: 0; }
      .bs-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .bs-key {
        font-size: 10px; color: #64748b; background: #0f172a;
        border: 1px solid #334155; border-radius: 4px; padding: 1px 5px; flex-shrink: 0;
      }
      .bs-flash {
        margin: 4px 12px; padding: 7px 9px; font-size: 11px;
        background: #450a0a; color: #fca5a5; border: 1px solid #7f1d1d; border-radius: 6px;
      }
      .bs-foot { border-top: 1px solid #334155; padding: 8px 14px; margin-top: 4px; }
      .bs-foot a { font-size: 11px; color: #94a3b8; text-decoration: none; }
      .bs-foot a:hover { color: #e2e8f0; }
    `;
    document.head.appendChild(s);
  }

  return { init };
})();
