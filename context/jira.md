# Integración con Jira

> **Todo lo org-específico de este archivo (dominio, keys de proyecto, custom field
> IDs, keys de epic, transition IDs) es configurable vía `.env` → `window.APP_CONFIG`.**
> Los valores concretos abajo (QAA, BG, `customfield_10271`, etc.) son **ejemplos** de
> una instancia real, no valores fijos en el código. Ver `config.md` para el mapeo.

## Instancia y proyectos

- **URL**: `https://<JIRA_HOST>` — de `.env` (`JIRA_HOST`), ej. `tu-empresa.atlassian.net`
- **API base**: `/rest/api/3` (Jira Cloud v3)
- **Acceso desde el cliente**: SIEMPRE `${JIRA_BASE}` = `window.location.origin + '/jira'` (NO direct)

## Proyectos

Las keys salen de `APP_CONFIG.projects` (`.qa` / `.bug` / `.tech`, desde `QA_PROJECT` / `BUG_PROJECT` / `TECH_PROJECT`). Ejemplos de una instancia real:

| Key (ej.) | `APP_CONFIG` | Para qué |
|-----------|--------------|----------|
| **QAA** | `projects.qa` | Test cases ejecutados, organizados bajo Epics |
| **BG** | `projects.bug` | Bugs encontrados durante QA |
| **SP** | `projects.tech` | Tech tasks (reporte TECH) |

## Issue types relevantes

- **Epic** (en QAA): contiene la estructura de TCs en su `description` (ver "QA_STRUCTURE" abajo)
- **Tarea** (en QAA): cada ejecución concreta de un TC, hija de un Epic vía `parent` + `customfield_10014`
- **Tarea / Bug** (en BG): bugs reportados

## Custom Fields

> Los IDs `customfield_XXXXX` de abajo son **ejemplos**: cada uno viene de una var de
> `.env` mapeada a `APP_CONFIG.fields` (ver `config.md`). En otra instancia de Jira los
> IDs son distintos — configurarlos, no hardcodearlos.

| `.env` | `APP_CONFIG.fields` | ID (ej.) |
|--------|---------------------|----------|
| `FIELD_REPORTER_EMAIL` | `reporterEmail` | `customfield_10271` |
| `FIELD_REPORTER_NAME` | `reporterName` | `customfield_10337` |
| `FIELD_EPIC_LINK` | `epicLink` | `customfield_10014` |
| `FIELD_BG_DEPENDENCY` | `bgDependency` | `customfield_10370` |
| `FIELD_CATEGORY` | `category` | `customfield_10441` |

| ID | Nombre | Set por | Para qué |
|----|--------|---------|----------|
| `customfield_10014` | Epic Link | Cliente | Vincular Tarea a su Epic (sistema viejo, compat) |
| `customfield_10271` | Reporter email | **Server.JS auto** | Email del usuario que reporta |
| `customfield_10337` | Reporter displayName | **Server.JS auto** | Nombre del usuario |
| `customfield_10370` | Dependencia BG | Cliente o `.env` | Vincula un issue QAA con su bug BG (tipo: option-with-child / cascadingselect) |
| `customfield_10441` | Categoria | Cliente o `.env` | Clasificación de tareas (tipo: option / select) |
| `customfield_10474` | Categorias (plural) | Cliente o `.env` | Otra clasificación (tipo: option) |

⚠️ Los campos 10370, 10441, 10474 no se auto-resuelven con el API token actual (HTTP 403 en `/context`). Si se necesitan, agregar a `.env`:
```
DEPENDENCIA_JSON={"id":"..."}
CATEGORIA_JSON={"id":"..."}
CATEGORIAS_JSON={"id":"..."}
```
Para obtener el `id`: en Jira UI → crear una tarea a mano → DevTools Network → POST `/rest/api/3/issue` → mirar el valor de ese customfield.

⚠️ NO mandar `customfield_10271` / `customfield_10337` desde el cliente — el server los pone.

## Epic con estructura QA (QA_STRUCTURE)

Cada Epic en QAA tiene en su `description` un bloque marcado con `QA_STRUCTURE_START` / `QA_STRUCTURE_END` que envuelve un JSON con la definición de sus Test Cases:

```
QA_STRUCTURE_START
{
  "meta": {
    "moduloSistema": "Notificaciones",   // labels para los TCs
    "prefix": "TC"                       // prefix de los IDs
  },
  "testCases": [
    {
      "id": "TC-01",
      "titulo": "Crear notificación válida",
      "tipoTest": "type-funcional",
      "prioridad": "Medium",
      "navegador": "Chrome",
      "sistemaOp": "Windows 11",
      "rolUsuario": "Profesor",
      "historia": "QAA-50",
      "impacto": "...",
      "urlPantalla": "https://app.../notificaciones",
      "precondiciones": ["...", "..."],
      "datos": ["...", "..."],
      "pasos": ["...", "..."],
      "resultadoEsperado": ["...", "..."],
      "postcondiciones": ["..."]
    }
  ]
}
QA_STRUCTURE_END
```

`bulk-epic.js` y `Qa_form.html` parsean este JSON con `cargarEstructuraEpic(epicKey)` para autocompletar form / generar TCs faltantes.

## Convención de Versions (fixVersion)

El proyecto QA tiene versions con un prefijo configurable (`VERSION_PREFIX` → `APP_CONFIG.workflow.versionPrefix`, ej. `test-v` → `test-v001`, `test-v003`).

`cargarVersionActual()` en bg_verificacion.html:
- Hace GET `/jira/rest/api/3/project/QAA/versions`
- Filtra `!released && name.startsWith('test-v')`
- Sortea descendente por name
- Toma `[0]` → esa es `versionActual`

Esta `versionActual` se aplica como `fixVersions: [{ name: versionActual }]` a cada issue creado.

## Patrón de creación de issue (POST /issue)

```js
const payload = {
  fields: {
    project:           { key: 'QAA' },
    parent:            { key: epicKey },          // hierarchy nuevo
    customfield_10014: epicKey,                   // Epic Link viejo (ambos)
    summary:           '...',
    issuetype:         { name: 'Tarea' },
    priority:          { name: 'Medium' },        // SOLO Highest|High|Medium|Low|Lowest
    labels:            ['estado-pass', 'type-funcional', ...],
    description:       { type:'doc', version:1, content:[...] },  // ADF
    ...(versionActual ? { fixVersions: [{ name: versionActual }] } : {})
  }
};
fetch(`${JIRA_BASE}/rest/api/3/issue`, { method:'POST', body: JSON.stringify(payload) });
```

⚠️ Priority: el screen de **edición** en QAA frecuentemente NO incluye priority. Por eso PUT puede tirar 400 INVALID_INPUT al actualizar issues existentes. Estrategia: retry sin priority si falla con 400.

## Búsqueda de issues (JQL)

`/rest/api/3/search/jql?jql=...&fields=...&maxResults=N`

Algunos JQLs típicos:
- `project = QAA AND issuetype = Epic ORDER BY created ASC`
- `parent = "QAA-X" AND statusCategory != Done`
- `project = QAA AND labels = "bg-XYZ"` (para encontrar QAA tasks de un bug)
- `project = BG AND status = "Under Review"`

## Transitions (cambiar estado)

```js
// 1. Listar transitions disponibles desde el estado actual
GET /rest/api/3/issue/{key}/transitions

// 2. Aplicar una
POST /rest/api/3/issue/{key}/transitions
body: { transition: { id: '31' } }
```

Para encontrar "Done" robustamente:
```js
const target = transitions.find(t => /done|terminad|finaliz|listo|cerrad|resuelto|complete|finish/i.test(t.name))
            || transitions.find(t => t.to?.statusCategory?.key === 'done');
```

Transition de finalizar: configurable vía `TRANSITION_FINALIZE` → `APP_CONFIG.workflow.finalizeTransitionId` (ej. `'31'` → "Finalizada" en QAA). El estado "Under Review" del proyecto de bugs sale de `STATUS_BUG_UNDER_REVIEW` → `APP_CONFIG.workflow.bugUnderReviewStatusId`.

## IssueLinks (vincular issues)

```js
POST /rest/api/3/issueLink
body: {
  type:         { name: 'Relates' },
  inwardIssue:  { key: 'QAA-200' },
  outwardIssue: { key: 'BG-50' }
}
```

Tipos comunes en este proyecto: `Relates`. Otros (`Blocks`, `Cloned`) no se usan.

## Attachments

```js
POST /rest/api/3/issue/{key}/attachments
headers: { 'X-Atlassian-Token': 'no-check' }
body: FormData con campo 'file'
```

⚠️ El header `X-Atlassian-Token: no-check` es OBLIGATORIO para attachments.

## ADF (Atlassian Document Format)

Las descripciones se serializan como JSON con shape:
```json
{ "type": "doc", "version": 1, "content": [<nodos>] }
```

Nodos comunes en este proyecto:
- `paragraph`, `heading` (con `attrs.level`), `text` (con opcional `marks`)
- `bulletList`, `orderedList`, `listItem`
- `table`, `tableRow`, `tableHeader`, `tableCell`
- `panel` (con `attrs.panelType`: `info`/`success`/`warning`/`error`/`note`)
- `rule` (separador horizontal)
- `inlineCard` (con `attrs.url`) — Jira lo renderiza como link al issue
- `text` con `marks: [{type:'link', attrs:{href}}]` — texto como link

Helpers ADF en el código (ver `conventions.md`).

## Estados y workflows

QAA tiene un workflow custom. Status comunes:
- `To Do` (default al crear)
- `In Progress`
- `Finalizada` (transition id 31)

BG tiene su propio workflow:
- `Open`, `Under Review`, `Done`, etc.

## Errores conocidos

- **400 INVALID_INPUT en PUT con `priority`**: el screen de edit no tiene priority. Retry sin priority.
- **404 al buscar issue por label** si el label tiene caracteres especiales: escapar comillas en JQL.
- **Lista vacía en ADF orderedList/bulletList**: Jira rechaza listas vacías → siempre poner al menos un item `mkP('—')`.
