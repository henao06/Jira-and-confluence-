# Convenciones de código

## Naming

- Variables y funciones: **camelCase** (`cargarPendientes`, `bulkState`, `versionActual`)
- Funciones "privadas" del archivo: prefix `_` (`_buildTCDescription`, `_transicionarADone`)
- Constantes: SCREAMING_SNAKE solo para verdaderas constantes (`JIRA_BASE`, `QAA_PARENT`, `_JIRA_BROWSE`)
- IDs HTML: kebab-case (`pending-loading`, `bulk-detail`, `bg-transition-${key}`)
- Clases CSS: kebab-case (`.btn-hdr-history`, `.bulk-epic-item`, `.tab-panel`)

## CSS

- Inline en cada HTML, dentro de `<style>` en el head
- Variables CSS en `:root`: `--g0` a `--g8` (grises), `--red`, `--red-b`, `--red-bg`, `--g1...g8`, `--border`, `--white`, `--s1` (shadow), `--rl` (radius large), `--sub` (text color sub)
- Shared en `styles.css` (importado vía `<link>` en cada page)
- BEM-light: `.bulk-task-row`, `.bulk-task-summary`, `.bulk-task-status` (mismo prefix por feature)
- Usar `:has()` selector para estados condicionales (ej. `.checkbox-label:has(input:checked)`)

## HTML

- onclick inline: `onclick="cambiarTab('bulk')"` — patrón del proyecto, no event listeners separados
- onchange inline: `onchange="setBulkResultado('pasa')"`
- Defensive: `event.stopPropagation()` cuando un link está dentro de un draggable
- `target="_blank" rel="noopener noreferrer"` para todos los links externos
- `<a>` styled como `badge-key` para hacer keys de Jira clickeables (clase con hover)

## Helpers globales en `bg_verificacion.html`

Estos están en el inline script, accesibles desde `bulk-epic.js` y código del page:

```js
JIRA_BASE       // window.location.origin + '/jira'
QAA_PARENT      // 'QAA-172' (epic padre del flow verif)
versionActual   // detectada en cargarVersionActual() — puede ser null

esc(str)              // escape HTML
extraerTextoADF(adf)  // ADF → texto plano

// ADF builders
mkH(text, level=2)              // heading
mkP(text)                       // paragraph
mkB(text)                       // paragraph bold
mkRule()                        // rule (separador)
mkPanel(panelType, content)     // panel
mkOrderedList(items)            // ol
mkBulletList(items)             // ul
mkTableCell(text, isHeader)
mkTableRow(label, value)
mkTable(rows)
mkIssueLink(key)                // text node con link a https://liceopinoverde.atlassian.net/browse/{key}
mkIssueRef(label, key)          // párrafo "label KEY"

// Búsqueda y diff
_parseJiraError(body, status)   // parsea error de Jira a string legible
buscarSubtareaQAAExistente(bgKey)
sincronizarSubtareaQAA(issue, finalizar)

// Helpers privados
_eqLabels, _eqFixVersions, _adfContieneKey, _existeLink
```

## Helpers específicos en `bulk-epic.js`

Reproduce ADF builders con prefix `_` para no chocar:
```js
_mkB(text), _mkPanel(panelType, content), _mkOrderedList(items)
_mkTableCell(text, isHeader), _mkTableRow(label, value), _mkTable(rows)

// Links
_mkLinkText(text, href)
_mkTableCellLink(text, href)
_mkTableRowLink(label, value, href)
_mkTableRowSmart(label, value)  // autodetecta Jira key / URL / plano

// Detección
_esJiraKey(s)  // matchea /^[A-Z]+-\d+$/
_esUrl(s)      // matchea /^https?:\/\//i

// Estructura Epic
_extraerTextoDeADF(adf)
_extractTCTitle(summary)  // ignora prefix "QAA-XX — " y emojis, devuelve titulo lowercase
_cargarEstructuraEpic(epicKey)  // parsea JSON entre QA_STRUCTURE_START/END, cachea
_estructuraCache = {}

// Build / POST
_buildTCDescription(tc, epic, resultado, textoObtenido)
_generarTC(tc, epic, resultado, textoObtenido, numero)
_subirAdjuntosA(taskKey, files)
_transicionarADone(taskKey)
```

## Patrón fetch

```js
const r = await fetch(`${JIRA_BASE}/rest/api/3/issue/${key}?fields=summary,status`, {
  headers: { Accept: 'application/json' }
});
if (!r.ok) throw new Error(`HTTP ${r.status}`);
const data = await r.json();
```

Para POST/PUT:
```js
await fetch(`${JIRA_BASE}/rest/api/3/issue`, {
  method:  'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body:    JSON.stringify(payload)
});
```

Para attachments:
```js
const fd = new FormData();
fd.append('file', file, file.name);
await fetch(`${JIRA_BASE}/rest/api/3/issue/${key}/attachments`, {
  method:  'POST',
  headers: { 'X-Atlassian-Token': 'no-check' },  // OBLIGATORIO
  body:    fd
});
```

## Patrón de estado

Variables globales (a nivel script) para estado de la página:
```js
const bugs       = {};   // key → issue data
const queue      = [];   // keys en orden
const colaItems  = {};   // key → { resultadosObtenidos, adjuntosNuevos, ... }
let   submitting = false;
let   jql        = '...';
```

Para módulos JS (como bulk-epic.js), un objeto exportado:
```js
const bulkState = {
  cargado:        false,
  epics:          [],
  selectedEpic:   null,
  // ...
};
```

## Idempotencia (importante)

Cuando se reapliquen operaciones, NO duplicar. Patrones usados:
- **Antes de POST issueLink**: chequear existencia con `_existeLink(links, kA, kB)`
- **Antes de append a description**: chequear si la key ya está en el ADF con `_adfContieneKey(adf, key)`
- **Antes de copiar adjuntos**: comparar por `filename` y skipear los ya presentes
- **Antes de transition**: chequear si el `statusCategory.key === 'done'` antes de finalizar

## Manejo de errores

- `try { ... } catch {}` silencioso en operaciones secundarias (adjuntos, links opcionales) — NO romper el flow principal
- `try { ... } catch (e) { ... throw new Error(...) }` en operaciones críticas (creación de issue)
- `console.error('[contexto]', e)` para logging útil
- Retry con fallback: si POST/PUT da 400 con campo específico (priority), reintentar sin ese campo

## Imports

NO se usa ningún módulo. Todo es:
- `<script src="/...js">` en HTML
- Funciones globales (sin export/import)
- `bulk-epic.js` depende de globales del host page

## Logs prefijo

Para distinguir logs en consola:
- `[QAA]` para creación/sync de subtareas QAA
- `[LINK]` para issueLinks
- `[bulk]` para operaciones de bulk-epic
- `[cargarPendientes]` para reload
- `[bulk-finalize]` (deprecado, ya no se usa)

## Lo que NO se hace

- ❌ No emojis en código (solo en UI strings cuando aporta)
- ❌ No comments tipo "este código hace X" si el código es legible
- ❌ No console.log persistentes (sí logs útiles con prefijo durante debug)
- ❌ No `--no-verify` en git
- ❌ No async/await sin try/catch en operaciones críticas
- ❌ No `Promise.all` para requests a Jira (preferir secuencial para evitar rate-limit)
