# Jira Integration

> **Everything org-specific in this file (domain, project keys, custom field
> IDs, epic keys, transition IDs) is configurable via `.env` → `window.APP_CONFIG`.**
> The concrete values below (QAA, BG, `customfield_10271`, etc.) are **examples** from
> a real instance, not values hardcoded in the code. See `config.md` for the mapping.

## Instance and projects

- **URL**: `https://<JIRA_HOST>` — from `.env` (`JIRA_HOST`), e.g. `tu-empresa.atlassian.net`
- **API base**: `/rest/api/3` (Jira Cloud v3)
- **Client-side access**: ALWAYS `${JIRA_BASE}` = `window.location.origin + '/jira'` (NOT direct)

## Projects

Keys come from `APP_CONFIG.projects` (`.qa` / `.bug` / `.tech`, from `QA_PROJECT` / `BUG_PROJECT` / `TECH_PROJECT`). Examples from a real instance:

| Key (e.g.) | `APP_CONFIG` | Purpose |
|-----------|--------------|----------|
| **QAA** | `projects.qa` | Executed test cases, organized under Epics |
| **BG** | `projects.bug` | Bugs found during QA |
| **SP** | `projects.tech` | Tech tasks (TECH report) |

## Relevant issue types

- **Epic** (in QAA): holds the TC structure in its `description` (see "QA_STRUCTURE" below)
- **Tarea** (in QAA): each concrete execution of a TC, child of an Epic via `parent` + `customfield_10014`
- **Tarea / Bug** (in BG): reported bugs

## Custom Fields

> The `customfield_XXXXX` IDs below are **examples**: each one comes from a `.env` var
> mapped to `APP_CONFIG.fields` (see `config.md`). In another Jira instance the
> IDs are different — configure them, don't hardcode them.

| `.env` | `APP_CONFIG.fields` | ID (e.g.) |
|--------|---------------------|----------|
| `FIELD_REPORTER_EMAIL` | `reporterEmail` | `customfield_10271` |
| `FIELD_REPORTER_NAME` | `reporterName` | `customfield_10337` |
| `FIELD_EPIC_LINK` | `epicLink` | `customfield_10014` |
| `FIELD_BG_DEPENDENCY` | `bgDependency` | `customfield_10370` |
| `FIELD_CATEGORY` | `category` | `customfield_10441` |

| ID | Name | Set by | Purpose |
|----|--------|---------|----------|
| `customfield_10014` | Epic Link | Client | Link a Tarea to its Epic (legacy system, compat) |
| `customfield_10271` | Reporter email | **Server.JS auto** | Email of the reporting user |
| `customfield_10337` | Reporter displayName | **Server.JS auto** | Name of the user |
| `customfield_10370` | BG dependency | Client or `.env` | Links a QAA issue with its BG bug (type: option-with-child / cascadingselect) |
| `customfield_10441` | Category | Client or `.env` | Task classification (type: option / select) |
| `customfield_10474` | Categories (plural) | Client or `.env` | Another classification (type: option) |

Warning: Fields 10370, 10441, 10474 do not auto-resolve with the current API token (HTTP 403 on `/context`). If needed, add to `.env`:
```
DEPENDENCIA_JSON={"id":"..."}
CATEGORIA_JSON={"id":"..."}
CATEGORIAS_JSON={"id":"..."}
```
To get the `id`: in the Jira UI → create a task manually → DevTools Network → POST `/rest/api/3/issue` → inspect the value of that customfield.

Warning: Do NOT send `customfield_10271` / `customfield_10337` from the client — the server sets them.

## Epic with QA structure (QA_STRUCTURE)

Each Epic in QAA has in its `description` a block marked with `QA_STRUCTURE_START` / `QA_STRUCTURE_END` that wraps a JSON with the definition of its Test Cases:

```
QA_STRUCTURE_START
{
  "meta": {
    "moduloSistema": "Notificaciones",   // labels for the TCs
    "prefix": "TC"                       // prefix of the IDs
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

`bulk-epic.js` and `Qa_form.html` parse this JSON with `cargarEstructuraEpic(epicKey)` to auto-fill the form / generate missing TCs.

## Versions convention (fixVersion)

The QA project has versions with a configurable prefix (`VERSION_PREFIX` → `APP_CONFIG.workflow.versionPrefix`, e.g. `test-v` → `test-v001`, `test-v003`).

`cargarVersionActual()` in bg_verificacion.html:
- Does GET `/jira/rest/api/3/project/QAA/versions`
- Filters `!released && name.startsWith('test-v')`
- Sorts descending by name
- Takes `[0]` → that is `versionActual`

This `versionActual` is applied as `fixVersions: [{ name: versionActual }]` to each created issue.

## Issue creation pattern (POST /issue)

```js
const payload = {
  fields: {
    project:           { key: 'QAA' },
    parent:            { key: epicKey },          // new hierarchy
    customfield_10014: epicKey,                   // legacy Epic Link (both)
    summary:           '...',
    issuetype:         { name: 'Tarea' },
    priority:          { name: 'Medium' },        // ONLY Highest|High|Medium|Low|Lowest
    labels:            ['estado-pass', 'type-funcional', ...],
    description:       { type:'doc', version:1, content:[...] },  // ADF
    ...(versionActual ? { fixVersions: [{ name: versionActual }] } : {})
  }
};
fetch(`${JIRA_BASE}/rest/api/3/issue`, { method:'POST', body: JSON.stringify(payload) });
```

Warning: Priority: the **edit** screen in QAA frequently does NOT include priority. That's why PUT can throw 400 INVALID_INPUT when updating existing issues. Strategy: retry without priority if it fails with 400.

## Issue search (JQL)

`/rest/api/3/search/jql?jql=...&fields=...&maxResults=N`

Some typical JQLs:
- `project = QAA AND issuetype = Epic ORDER BY created ASC`
- `parent = "QAA-X" AND statusCategory != Done`
- `project = QAA AND labels = "bg-XYZ"` (to find QAA tasks of a bug)
- `project = BG AND status = "Under Review"`

## Transitions (change state)

```js
// 1. List available transitions from the current state
GET /rest/api/3/issue/{key}/transitions

// 2. Apply one
POST /rest/api/3/issue/{key}/transitions
body: { transition: { id: '31' } }
```

To find "Done" robustly:
```js
const target = transitions.find(t => /done|terminad|finaliz|listo|cerrad|resuelto|complete|finish/i.test(t.name))
            || transitions.find(t => t.to?.statusCategory?.key === 'done');
```

Finalize transition: configurable via `TRANSITION_FINALIZE` → `APP_CONFIG.workflow.finalizeTransitionId` (e.g. `'31'` → "Finalizada" in QAA). The "Under Review" status of the bug project comes from `STATUS_BUG_UNDER_REVIEW` → `APP_CONFIG.workflow.bugUnderReviewStatusId`.

## IssueLinks (link issues)

```js
POST /rest/api/3/issueLink
body: {
  type:         { name: 'Relates' },
  inwardIssue:  { key: 'QAA-200' },
  outwardIssue: { key: 'BG-50' }
}
```

Common types in this project: `Relates`. Others (`Blocks`, `Cloned`) are not used.

## Attachments

```js
POST /rest/api/3/issue/{key}/attachments
headers: { 'X-Atlassian-Token': 'no-check' }
body: FormData with field 'file'
```

Warning: The header `X-Atlassian-Token: no-check` is MANDATORY for attachments.

## ADF (Atlassian Document Format)

Descriptions are serialized as JSON with shape:
```json
{ "type": "doc", "version": 1, "content": [<nodos>] }
```

Common nodes in this project:
- `paragraph`, `heading` (with `attrs.level`), `text` (with optional `marks`)
- `bulletList`, `orderedList`, `listItem`
- `table`, `tableRow`, `tableHeader`, `tableCell`
- `panel` (with `attrs.panelType`: `info`/`success`/`warning`/`error`/`note`)
- `rule` (horizontal separator)
- `inlineCard` (with `attrs.url`) — Jira renders it as a link to the issue
- `text` with `marks: [{type:'link', attrs:{href}}]` — text as link

ADF helpers in the code (see `conventions.md`).

## States and workflows

QAA has a custom workflow. Common statuses:
- `To Do` (default on creation)
- `In Progress`
- `Finalizada` (transition id 31)

BG has its own workflow:
- `Open`, `Under Review`, `Done`, etc.

## Known errors

- **400 INVALID_INPUT on PUT with `priority`**: the edit screen has no priority. Retry without priority.
- **404 when searching an issue by label** if the label has special characters: escape quotes in the JQL.
- **Empty list in ADF orderedList/bulletList**: Jira rejects empty lists → always put at least one item `mkP('—')`.
