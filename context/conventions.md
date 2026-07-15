# Code conventions

## Naming

- Variables and functions: **camelCase** (`cargarPendientes`, `bulkState`, `versionActual`)
- File-"private" functions: prefix `_` (`_buildTCDescription`, `_transicionarADone`)
- Constants: SCREAMING_SNAKE only for true constants (`JIRA_BASE`, `QAA_PARENT`, `_JIRA_BROWSE`)
- HTML IDs: kebab-case (`pending-loading`, `bulk-detail`, `bg-transition-${key}`)
- CSS classes: kebab-case (`.btn-hdr-history`, `.bulk-epic-item`, `.tab-panel`)

## CSS

- Inline in each HTML, inside `<style>` in the head
- CSS variables in `:root`: `--g0` to `--g8` (grays), `--red`, `--red-b`, `--red-bg`, `--g1...g8`, `--border`, `--white`, `--s1` (shadow), `--rl` (radius large), `--sub` (sub text color)
- Shared in `styles.css` (imported via `<link>` in each page)
- BEM-light: `.bulk-task-row`, `.bulk-task-summary`, `.bulk-task-status` (same prefix per feature)
- Use the `:has()` selector for conditional states (e.g. `.checkbox-label:has(input:checked)`)

## HTML

- Inline onclick: `onclick="cambiarTab('bulk')"` — project pattern, no separate event listeners
- Inline onchange: `onchange="setBulkResultado('pasa')"`
- Defensive: `event.stopPropagation()` when a link is inside a draggable
- `target="_blank" rel="noopener noreferrer"` for all external links
- `<a>` styled as `badge-key` to make Jira keys clickable (class with hover)

## UI conventions (icons & labels)

- **Icon convention**: emojis were replaced by an SVG icon system. Use `<span class="ico" data-icon="NAME"></span>` in static HTML (auto-replaced by `icons.js` on load), or `Icons.svg('NAME',{size})` in JS-generated HTML. Do NOT use emojis in the UI.
- **Text convention**: UI texts are configurable via `data-label="KEY"` + `labels.js` (which read `APP_CONFIG.labels`).

## Global helpers in `bg_verificacion.html`

These live in the inline script, accessible from `bulk-epic.js` and page code:

```js
JIRA_BASE       // window.location.origin + '/jira'
QAA_PARENT      // 'QAA-172' (parent epic of the verif flow)
versionActual   // detected in cargarVersionActual() — may be null

esc(str)              // escape HTML
extraerTextoADF(adf)  // ADF → plain text

// ADF builders
mkH(text, level=2)              // heading
mkP(text)                       // paragraph
mkB(text)                       // bold paragraph
mkRule()                        // rule (separator)
mkPanel(panelType, content)     // panel
mkOrderedList(items)            // ol
mkBulletList(items)             // ul
mkTableCell(text, isHeader)
mkTableRow(label, value)
mkTable(rows)
mkIssueLink(key)                // text node with link to APP_CONFIG.jira.browseUrl + {key}
mkIssueRef(label, key)          // paragraph "label KEY"

// Search and diff
_parseJiraError(body, status)   // parses a Jira error into a readable string
buscarSubtareaQAAExistente(bgKey)
sincronizarSubtareaQAA(issue, finalizar)

// Private helpers
_eqLabels, _eqFixVersions, _adfContieneKey, _existeLink
```

## Specific helpers in `bulk-epic.js`

Reproduces ADF builders with prefix `_` to avoid collisions:
```js
_mkB(text), _mkPanel(panelType, content), _mkOrderedList(items)
_mkTableCell(text, isHeader), _mkTableRow(label, value), _mkTable(rows)

// Links
_mkLinkText(text, href)
_mkTableCellLink(text, href)
_mkTableRowLink(label, value, href)
_mkTableRowSmart(label, value)  // auto-detects Jira key / URL / plain

// Detection
_esJiraKey(s)  // matches /^[A-Z]+-\d+$/
_esUrl(s)      // matches /^https?:\/\//i

// Epic structure
_extraerTextoDeADF(adf)
_extractTCTitle(summary)  // ignores prefix "QAA-XX — " and emojis, returns lowercase title
_cargarEstructuraEpic(epicKey)  // parses JSON between QA_STRUCTURE_START/END, caches
_estructuraCache = {}

// Build / POST
_buildTCDescription(tc, epic, resultado, textoObtenido)
_generarTC(tc, epic, resultado, textoObtenido, numero)
_subirAdjuntosA(taskKey, files)
_transicionarADone(taskKey)
```

## Fetch pattern

```js
const r = await fetch(`${JIRA_BASE}/rest/api/3/issue/${key}?fields=summary,status`, {
  headers: { Accept: 'application/json' }
});
if (!r.ok) throw new Error(`HTTP ${r.status}`);
const data = await r.json();
```

For POST/PUT:
```js
await fetch(`${JIRA_BASE}/rest/api/3/issue`, {
  method:  'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body:    JSON.stringify(payload)
});
```

For attachments:
```js
const fd = new FormData();
fd.append('file', file, file.name);
await fetch(`${JIRA_BASE}/rest/api/3/issue/${key}/attachments`, {
  method:  'POST',
  headers: { 'X-Atlassian-Token': 'no-check' },  // MANDATORY
  body:    fd
});
```

## State pattern

Global variables (script-level) for page state:
```js
const bugs       = {};   // key → issue data
const queue      = [];   // keys in order
const colaItems  = {};   // key → { resultadosObtenidos, adjuntosNuevos, ... }
let   submitting = false;
let   jql        = '...';
```

For JS modules (like bulk-epic.js), an exported object:
```js
const bulkState = {
  cargado:        false,
  epics:          [],
  selectedEpic:   null,
  // ...
};
```

## Idempotency (important)

When operations are reapplied, do NOT duplicate. Patterns used:
- **Before POST issueLink**: check existence with `_existeLink(links, kA, kB)`
- **Before appending to description**: check if the key is already in the ADF with `_adfContieneKey(adf, key)`
- **Before copying attachments**: compare by `filename` and skip those already present
- **Before transition**: check whether `statusCategory.key === 'done'` before finalizing

## Error handling

- Silent `try { ... } catch {}` on secondary operations (attachments, optional links) — do NOT break the main flow
- `try { ... } catch (e) { ... throw new Error(...) }` on critical operations (issue creation)
- `console.error('[contexto]', e)` for useful logging
- Retry with fallback: if POST/PUT returns 400 with a specific field (priority), retry without that field

## Imports

No modules are used. Everything is:
- `<script src="/...js">` in HTML
- Global functions (no export/import)
- `bulk-epic.js` depends on globals of the host page

## Log prefixes

To distinguish logs in the console:
- `[QAA]` for QAA subtask creation/sync
- `[LINK]` for issueLinks
- `[bulk]` for bulk-epic operations
- `[cargarPendientes]` for reload
- `[bulk-finalize]` (deprecated, no longer used)

## What is NOT done

- Avoid: No emojis in code (only in UI strings when it adds value)
- Avoid: No comments like "this code does X" if the code is readable
- Avoid: No persistent console.log (useful prefixed logs during debug are fine)
- Avoid: No `--no-verify` in git
- Avoid: No async/await without try/catch on critical operations
- Avoid: No `Promise.all` for requests to Jira (prefer sequential to avoid rate-limits)
