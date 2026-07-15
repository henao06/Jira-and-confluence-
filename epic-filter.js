/**
 * epic-filter.js — Filtro persistente de Epics por página
 * Uso:
 *   EpicFilter.init({ pageKey: 'bg-verificacion', container: document.getElementById('...'), onUpdate: () => reload() })
 *   EpicFilter.setEpics([{ key: 'PROJ-1', name: 'Epic name' }, ...])
 *   EpicFilter.getJqlClause()  → ' AND "Epic Link" not in ("PROJ-1","PROJ-2")' | ''
 */

const EpicFilter = (() => {
  let _pageKey   = '';
  let _onUpdate  = null;
  let _available = []; // [{ key, name }]
  let _panelEl   = null;
  let _btnEl     = null;

  // ── Persistencia ──────────────────────────────────────────────────────────

  function _storageKey() { return `epic-filter:${_pageKey}`; }

  function _load() {
    try { return JSON.parse(localStorage.getItem(_storageKey()) || '[]'); }
    catch { return []; }
  }

  function _save(keys) {
    localStorage.setItem(_storageKey(), JSON.stringify(keys));
  }

  function _getIgnored() { return _load(); }

  function _addIgnored(key) {
    const current = _load();
    if (!current.includes(key)) { current.push(key); _save(current); }
  }

  function _removeIgnored(key) {
    _save(_load().filter(k => k !== key));
  }

  // ── API pública ───────────────────────────────────────────────────────────

  function getJqlClause() {
    const ignored = _getIgnored();
    if (!ignored.length) return '';
    return ` AND "Epic Link" not in (${ignored.map(k => `"${k}"`).join(',')})`;
  }

  function setEpics(epics) {
    _available = epics.filter((e, i, arr) => arr.findIndex(x => x.key === e.key) === i);
    if (_panelEl) _renderPanelContent();
    _updateBadge();
  }

  async function loadEpicsFromJira(jiraBase) {
    try {
      const jql = `project = ${APP_CONFIG.projects.qa} AND issuetype = Epic ORDER BY created ASC`;
      const r = await fetch(
        `${jiraBase}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary&maxResults=100`,
        { headers: { Accept: 'application/json' } }
      );
      if (!r.ok) return;
      const data = await r.json();
      const epics = (data.issues || []).map(i => ({ key: i.key, name: i.fields?.summary || i.key }));
      setEpics(epics);
    } catch {}
  }

  function getIgnoredEpics() { return _getIgnored(); }

  // ── UI ────────────────────────────────────────────────────────────────────

  function init({ pageKey, container, onUpdate }) {
    _pageKey  = pageKey;
    _onUpdate = onUpdate;

    _injectStyles();

    // Botón en el header
    _btnEl = document.createElement('button');
    _btnEl.className = 'ef-btn';
    _btnEl.title     = 'Filtrar Epics ignorados';
    _btnEl.innerHTML = `
      <svg fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
      </svg>
      <span class="ef-btn-label">Epics</span>
      <span class="ef-badge" id="ef-badge-${pageKey}" style="display:none">0</span>`;
    _btnEl.addEventListener('click', e => { e.stopPropagation(); _togglePanel(); });
    container.appendChild(_btnEl);

    // Panel flotante
    _panelEl = document.createElement('div');
    _panelEl.className = 'ef-panel';
    _panelEl.style.display = 'none';
    _renderPanelContent();
    document.body.appendChild(_panelEl);

    // Cerrar al click fuera
    document.addEventListener('click', e => {
      if (_panelEl.style.display !== 'none' && !_panelEl.contains(e.target) && e.target !== _btnEl) {
        _panelEl.style.display = 'none';
      }
    });

    _updateBadge();
  }

  function _togglePanel() {
    if (_panelEl.style.display === 'none') {
      _positionPanel();
      _panelEl.style.display = 'flex';
      _panelEl.querySelector('.ef-input')?.focus();
    } else {
      _panelEl.style.display = 'none';
    }
  }

  function _positionPanel() {
    const rect = _btnEl.getBoundingClientRect();
    _panelEl.style.top   = (rect.bottom + 6 + window.scrollY) + 'px';
    _panelEl.style.right = (window.innerWidth - rect.right) + 'px';
    _panelEl.style.left  = 'auto';
  }

  function _renderPanelContent() {
    const ignored = _getIgnored();

    _panelEl.innerHTML = `
      <div class="ef-panel-header">
        <span>Epics ignorados</span>
        <button class="ef-close">✕</button>
      </div>

      <div class="ef-section-title">Ignorando ahora</div>
      <div class="ef-chips" id="ef-ignored-${_pageKey}"></div>

      <div class="ef-section-title">Disponibles</div>
      <div class="ef-chips" id="ef-available-${_pageKey}"></div>

      <div class="ef-input-row">
        <input class="ef-input" placeholder="Agregar epic key (ej: ${APP_CONFIG.projects.qa}-1)" />
        <button class="ef-add-btn">+</button>
      </div>
    `;

    _panelEl.querySelector('.ef-close').addEventListener('click', () => {
      _panelEl.style.display = 'none';
    });

    const input  = _panelEl.querySelector('.ef-input');
    const addBtn = _panelEl.querySelector('.ef-add-btn');

    const doAdd = () => {
      const val = input.value.trim().toUpperCase();
      if (!val) return;
      _addIgnored(val);
      input.value = '';
      _renderPanelContent();
      _updateBadge();
      if (_onUpdate) _onUpdate();
    };

    addBtn.addEventListener('click', doAdd);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });

    _fillChips(ignored, `ef-ignored-${_pageKey}`, true);
    _fillChips(_available.filter(e => !ignored.includes(e.key)), `ef-available-${_pageKey}`, false);
  }

  function _fillChips(items, containerId, isIgnored) {
    const el = _panelEl.querySelector(`#${containerId}`);
    if (!el) return;
    if (!items.length) {
      el.innerHTML = `<span class="ef-empty">${isIgnored ? 'Ninguno' : 'No detectados aún'}</span>`;
      return;
    }
    el.innerHTML = '';
    items.forEach(item => {
      const key  = typeof item === 'string' ? item : item.key;
      const name = typeof item === 'string' ? key  : (item.name || key);
      const chip = document.createElement('div');
      chip.className = `ef-chip ${isIgnored ? 'ef-chip-ignored' : 'ef-chip-available'}`;
      chip.innerHTML = `<span title="${name}">${key}</span><button>${isIgnored ? '✕' : '+'}</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        if (isIgnored) _removeIgnored(key);
        else           _addIgnored(key);
        _renderPanelContent();
        _updateBadge();
        if (_onUpdate) _onUpdate();
      });
      el.appendChild(chip);
    });
  }

  function _updateBadge() {
    const count = _getIgnored().length;
    const badge = document.getElementById(`ef-badge-${_pageKey}`);
    if (!badge) return;
    badge.textContent    = count;
    badge.style.display  = count ? 'inline-flex' : 'none';
    if (_btnEl) _btnEl.classList.toggle('ef-btn-active', count > 0);
  }

  // ── Estilos ───────────────────────────────────────────────────────────────

  function _injectStyles() {
    if (document.getElementById('ef-styles')) return;
    const s = document.createElement('style');
    s.id = 'ef-styles';
    s.textContent = `
      .ef-btn {
        display: inline-flex; align-items: center; gap: 5px;
        background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
        color: #94a3b8; border-radius: 7px; padding: 5px 10px;
        font-size: 12px; font-weight: 600; font-family: inherit;
        cursor: pointer; transition: all .15s; white-space: nowrap;
      }
      .ef-btn svg { width: 13px; height: 13px; stroke: currentColor; }
      .ef-btn:hover, .ef-btn-active { background: rgba(99,102,241,.15); border-color: rgba(99,102,241,.4); color: #a5b4fc; }
      .ef-badge {
        background: #6366f1; color: #fff; border-radius: 50%;
        width: 16px; height: 16px; font-size: 9px; font-weight: 700;
        align-items: center; justify-content: center;
      }
      .ef-panel {
        position: absolute; z-index: 9000;
        background: #1e293b; border: 1px solid #334155;
        border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,.4);
        width: 280px; flex-direction: column; gap: 0;
        font-family: inherit;
      }
      .ef-panel-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px 8px; border-bottom: 1px solid #334155;
        font-size: 12px; font-weight: 700; color: #f1f5f9;
      }
      .ef-close {
        background: none; border: none; color: #64748b;
        cursor: pointer; font-size: 14px; padding: 0 2px;
      }
      .ef-close:hover { color: #f1f5f9; }
      .ef-section-title {
        padding: 8px 14px 4px; font-size: 10px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .06em; color: #64748b;
      }
      .ef-chips {
        display: flex; flex-wrap: wrap; gap: 5px;
        padding: 0 14px 10px; min-height: 28px;
      }
      .ef-chip {
        display: inline-flex; align-items: center; gap: 4px;
        border-radius: 5px; padding: 3px 6px 3px 8px;
        font-size: 11px; font-weight: 600;
      }
      .ef-chip span { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ef-chip button {
        background: none; border: none; cursor: pointer;
        font-size: 11px; padding: 0 1px; line-height: 1;
      }
      .ef-chip-ignored { background: #450a0a; color: #fca5a5; border: 1px solid #7f1d1d; }
      .ef-chip-ignored button { color: #f87171; }
      .ef-chip-ignored button:hover { color: #fff; }
      .ef-chip-available { background: #0f172a; color: #94a3b8; border: 1px solid #334155; }
      .ef-chip-available button { color: #6366f1; }
      .ef-chip-available button:hover { color: #a5b4fc; }
      .ef-empty { font-size: 11px; color: #475569; font-style: italic; }
      .ef-input-row {
        display: flex; gap: 6px; padding: 8px 14px 12px;
        border-top: 1px solid #1e293b;
      }
      .ef-input {
        flex: 1; background: #0f172a; border: 1px solid #334155;
        border-radius: 5px; padding: 5px 8px; color: #f1f5f9;
        font-size: 11px; font-family: inherit; outline: none;
      }
      .ef-input:focus { border-color: #6366f1; }
      .ef-add-btn {
        background: #6366f1; border: none; color: #fff;
        border-radius: 5px; padding: 5px 10px; cursor: pointer;
        font-size: 14px; font-weight: 700; font-family: inherit;
      }
      .ef-add-btn:hover { background: #4f46e5; }
    `;
    document.head.appendChild(s);
  }

  return { init, setEpics, loadEpicsFromJira, getJqlClause, getIgnoredEpics };
})();
