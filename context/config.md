# Configuration (config system)

> How the app became **org-neutral**: everything specific to an organization
> (Jira domain, project keys, custom fields, epics, workflow, branding) comes
> from `.env` and reaches the front-end as `window.APP_CONFIG`.
> See also: `architecture.md`, `jira.md`, `current-state.md` (2026-07-15 entry).

## Configuration flow

```
.env  ──read by──►  Server.JS (builds CONFIG object)
                          │
                          │  exposes via GET /config.js  →  window.APP_CONFIG = {...}
                          ▼
                     Front-end (HTML + shared .js)
                          ALWAYS read from APP_CONFIG (nothing hardcoded)
```

1. **`.env`** — source of truth. Not committed. See `.env.example` at the repo root for the full schema.
2. **`Server.JS`** — on startup it reads `process.env` and builds a `CONFIG` object (grouped by domain: jira, projects, fields, epics, workflow, confluence, branding).
3. **`GET /config.js`** — the server serves a JS script that assigns `window.APP_CONFIG = <serialized CONFIG>`. It is a dynamic endpoint, not a static file.
4. **Front-end** — every page loads `/config.js` as the **first `<script>` in the `<head>`** (before any other JS), so that `window.APP_CONFIG` already exists when the rest of the code runs.

### Server always starts (DEFAULT_PORT = 8080)

The server **ALWAYS boots even if the `.env` is missing**. If `PORT` is absent or
invalid, parsing yields `NaN` and the server falls back to `DEFAULT_PORT = 8080`, so
it can still serve `/connect` and generate the `.env`. It **never crashes due to
missing config**. `POST /setup/secrets` ignores an invalid `PORT` (it does not write a
bad value to the `.env`).

### Fail-soft gates → /connect and /setup (replaces the old 503)

`Server.JS` no longer does fail-fast with a 503 page. There are **two** separate
**gates**, in order:

1. **Missing secrets** (`JIRA_HOST`/`JIRA_EMAIL`/`JIRA_TOKEN`) → **302 → `/connect`**
   (the minimal connection gate, see "Layer 1" below).
2. **Missing / invalid `qa-config.json`** → `getConfig()` returns an empty neutral
   config (`resolveConfig({})`) with `setupRequired=true` → **302 → `/setup`**
   (the customization wizard). There is NO fallback via `.env` variables.
3. **All good** → the app runs.

Only the **app pages** are intercepted. The **allowlist** that ALWAYS passes through
(without redirecting): static assets (css/js), `/config.js`, `/setup`, `/setup/*`,
`/connect`, `/jira/*`, `/wiki/*`. This way the gates can load, test the connection and
save without getting trapped in their own redirect.

> `qa-config.json` is the **single source** of structural config: if it is missing or
> invalid, the `/setup` wizard is **forced** (there is no `.env` fallback). The old
> structural `.env` variables (`QA_PROJECT` etc.) are deprecated and are **no longer
> read** — the `.env` only holds connection secrets.

## Environment variables

After removing the legacy fallback, the `.env` holds **ONLY connection secrets**. The
structural config (projects, fields, epics, workflow, confluence, branding) lives
**only in `qa-config.json`** and is edited from the wizard.

### Secrets (the only thing the `.env` reads today)

| Variable | Req/Opt | Description |
|----------|---------|-------------|
| `PORT` | Req | HTTP port where Server.JS listens (falls back to `DEFAULT_PORT = 8080` if missing/invalid) |
| `JIRA_HOST` | Req | Host of the Jira Cloud instance (e.g. `your-company.atlassian.net`) |
| `JIRA_EMAIL` | Req | Email of the Jira account/bot for Basic auth |
| `JIRA_TOKEN` | Req | Atlassian API token for Basic auth |

> If `JIRA_HOST`/`JIRA_EMAIL`/`JIRA_TOKEN` are missing → redirect to the `/connect` gate.

### DEPRECATED structural variables (no longer read)

These variables were read by the old `resolveFromEnv()` (removed). Today the server
**ignores** them: their equivalent lives in `qa-config.json` (see "Resolution to the
flat shape"). They are listed only as historical reference / mapping:

| Deprecated variable | Current equivalent in `qa-config.json` |
|-------------------|----------------------------------------|
| `QA_PROJECT` / `BUG_PROJECT` / `TECH_PROJECT` | `boards.qa` / `.bug` / `.tech` (active board) |
| `FIELD_REPORTER_EMAIL` / `FIELD_REPORTER_NAME` / `FIELD_CATEGORY` / `FIELD_EPIC_LINK` / `FIELD_BG_DEPENDENCY` | `fields.*` |
| `EPIC_VERIFICATION` / `EPIC_ACTIVITIES` | `epics.*` of the active QA board |
| `TRANSITION_FINALIZE` / `STATUS_BUG_UNDER_REVIEW` / `VERSION_PREFIX` | `workflow.*` |
| `CONFLUENCE_HISTORY_PAGE_ID` / `CONFLUENCE_SPACE` | `confluence.*` |
| `ORG_NAME` / `APP_NAME` | `branding.*` |

> General rule (in `qa-config.json`): an **empty optional section = feature off**. E.g.
> without `boards.bug` you cannot report/verify bugs; without `confluence` nothing is published.

## Shape of `window.APP_CONFIG` (the contract)

This is the object the front-end consumes. It groups the variables by domain:

```js
window.APP_CONFIG = {
  jira:       { host, baseUrl, browseUrl },
  projects:   { qa, bug, tech },
  fields:     { reporterEmail, reporterName, category, epicLink, bgDependency },
  epics:      { verification, activities },
  workflow:   { finalizeTransitionId, bugUnderReviewStatusId, versionPrefix },
  confluence: { historyPageId, space },
  issueTypes: { testCase, techTask, options },
  branding:   { orgName, appName }
}
```

**Historical** mapping `.env` → `APP_CONFIG` (reference of the original neutralization
contract). **Today, after removing the legacy fallback, only `JIRA_HOST` comes from the
`.env`**; the rest of the `APP_CONFIG` paths are filled by `resolveConfig()` from
`qa-config.json` (see the deprecated-variables table and "Resolution to the flat shape"):

| `.env` (historical column) | Path in `APP_CONFIG` |
|--------|----------------------|
| `JIRA_HOST` | `jira.host` (+ derived `jira.baseUrl`, `jira.browseUrl`) — **still from `.env`** |
| `QA_PROJECT` / `BUG_PROJECT` / `TECH_PROJECT` | `projects.qa` / `.bug` / `.tech` |
| `FIELD_REPORTER_EMAIL` / `FIELD_REPORTER_NAME` | `fields.reporterEmail` / `.reporterName` |
| `FIELD_CATEGORY` / `FIELD_EPIC_LINK` / `FIELD_BG_DEPENDENCY` | `fields.category` / `.epicLink` / `.bgDependency` |
| `EPIC_VERIFICATION` / `EPIC_ACTIVITIES` | `epics.verification` / `.activities` |
| `TRANSITION_FINALIZE` / `STATUS_BUG_UNDER_REVIEW` / `VERSION_PREFIX` | `workflow.finalizeTransitionId` / `.bugUnderReviewStatusId` / `.versionPrefix` |
| `CONFLUENCE_HISTORY_PAGE_ID` / `CONFLUENCE_SPACE` | `confluence.historyPageId` / `.space` |
| `ORG_NAME` / `APP_NAME` | `branding.orgName` / `.appName` |

> Note: `JIRA_EMAIL` and `JIRA_TOKEN` are NOT exposed in `APP_CONFIG` (they are
> server-side auth secrets). The server uses them for the proxy's `Authorization` header.

### Issue types (`APP_CONFIG.issueTypes`)

`APP_CONFIG.issueTypes = { testCase, techTask, options }` defines the issue-type names
used when building issue-creation payloads and in the issue-type change menu of
`history.html`.

- **Neutral defaults** in `Server.JS` `resolveConfig`:
  - `testCase: "Tarea"`
  - `techTask: "Tech Task"`
  - `options: ["Tarea", "Subtarea", "Historia", "Error"]`
- Each instance **overrides** them from `qa-config.json` → `issueTypes`.
- The values **must match the issue types of the target Jira instance** (e.g. use
  `"Task"` if that instance is in English).
- Editable in the wizard.

## How the front-end consumes it

- Every HTML includes, as the **first script in the `<head>`**:
  ```html
  <script src="/config.js"></script>
  ```
  This guarantees that `window.APP_CONFIG` exists before running any logic.
- Inline JS and shared modules read from there, for example:
  ```js
  const JIRA_BASE = window.location.origin + '/jira';   // the proxy stays the same
  const QA = window.APP_CONFIG.projects.qa;              // before: 'QAA' hardcoded
  const EPIC_VERIF = window.APP_CONFIG.epics.verification;
  ```
- **No org-specific values hardcoded** in HTML/JS: project keys, custom field IDs,
  epic keys, transition IDs, version prefix and branding all come from `APP_CONFIG`.

### Icons (`icons.js`)

`icons.js` is an SVG icon system that replaces emojis in the UI. The front-end marks an
element with the attribute **`data-icon="name"`** and the applier injects the SVG; JS
can also render one on demand via **`window.Icons.svg()`**. This keeps the UI free of
emoji glyphs and consistent across pages. Configurable UI text is already documented
separately (see "Layer 3 — Configurable interface text (labels)").

## To add a new config variable

1. Add it to `.env` and document it in `.env.example`.
2. Map it in the `CONFIG` object of `Server.JS` (under the relevant domain).
3. Consume it in the front-end via `window.APP_CONFIG.<domain>.<key>`.
4. If it is required to start, add it to the config validation.
5. Document it in this file (variables table + mapping table).

## Setup wizard + qa-config.json (Phase 1)

Starting in Phase 1 the app is configured from a **browser UI** (first-boot wizard)
instead of editing `.env` by hand. The structural config lives in a JSON, and the
secrets remain ONLY in `.env`.

### Config precedence (in `Server.JS`)

```
valid qa-config.json  →  used
missing/invalid qa-config.json  →  empty neutral config (setupRequired=true) → wizard /setup
```

1. **Valid `qa-config.json`** — **SINGLE source** of the structural config: it is used.
2. **Missing or invalid** — `getConfig()` returns an empty neutral config
   (`resolveConfig({})`) with `setupRequired=true` → the server **forces** the redirect
   to `/setup` (see "Fail-soft → /setup").

> **There is NO fallback via `.env` variables.** The old `resolveFromEnv()` (and its
> `envBoardMeta()`) were **removed** from `Server.JS`. A `.env` with `QA_PROJECT` etc.
> is no longer enough to start without JSON: without a valid `qa-config.json`, the
> wizard is mandatory.

### `qa-config.json` (new file)

- **Gitignored**, generated by the wizard, **WITHOUT secrets** (does not store token or creds).
- Contains the structural config. Shape:
  ```json
  {
    "version": 1,
    "boards": {
      "qa":  { "activeBoardId": "<id>",
               "items": [ { "id": "<id>", "name": "<str>", "projectKey": "<KEY>",
                            "epics": { "verification": "<KEY-n>", "activities": "<KEY-n>" } } ] },
      "bug": { "activeBoardId": "<id>", "items": [ ... ] },
      "tech":{ "activeBoardId": "<id>", "items": [ ... ] }
    },
    "fields":     { },
    "workflow":   { },
    "confluence": { "enabled": false },
    "issueTypes": { },
    "branding":   { }
  }
  ```
- **Boards are arrays** (1 or N items, no cap); `activeBoardId` picks the active one per
  type. The **epics live in the active QA board**.

| Section | Required/Optional |
|---------|--------------------|
| `boards.qa` | **Required** — ≥1 item with `projectKey` |
| `boards.bug` / `boards.tech` | Optional (empty → feature off) |
| `fields` | Optional |
| `workflow` | Optional |
| `confluence` (with `enabled` toggle) | Optional |
| `issueTypes` | Optional (overrides the neutral defaults) |
| `branding` | Optional |

### Resolution to the flat `APP_CONFIG` shape

`Server.JS` did not change the front-end contract. `resolveConfig()` takes the **active
board** of each type (`activeBoardId`) and flattens it to the same `window.APP_CONFIG`
as always: `projects.qa/bug/tech`, `epics.*` of the active QA board, etc. The ~70
front-end consumers did NOT change.

### Hot-reload

`GET /config.js` re-reads `qa-config.json` with a **cache keyed by `mtime`**
(`getConfig()`). Whatever the wizard saves is reflected on the next page reload
**without restarting** the server (the only exception: changing `PORT`, which does
require a restart).

### Secrets (invariant)

- `JIRA_HOST` / `JIRA_EMAIL` / `JIRA_TOKEN` / `PORT` remain **ONLY in `.env`**.
- **Invariant**: the token is NEVER in `APP_CONFIG` nor in `qa-config.json`.
  `resolveConfig()` does not copy it and no setup endpoint returns it.
- The `/connect` gate (endpoint `POST /setup/secrets`) writes the `.env`
  **server-side** (upsert preserving existing lines) and rebuilds AUTH in memory. See
  "Config in 3 layers → Layer 1".

### New endpoints (setup)

| Endpoint | What it does |
|----------|--------------|
| `GET /setup` (pretty route → `setup.html`) | Serves the customization wizard |
| `GET /connect` (→ `connect.html`) | Serves the minimal connection gate (secrets only) |
| `GET /setup/status` | Reports what is missing to complete the config |
| `POST /setup/secrets` | Saves ONLY secrets: upsert `.env` (`JIRA_HOST/JIRA_EMAIL/JIRA_TOKEN/PORT`) + **rebuild AUTH in memory** (no restart). Never returns the token |
| `POST /setup/save` | Sends ONLY `{config}` (no longer includes secrets). Validates with `validateConfig` → writes `qa-config.json`. **422** if invalid |
| `POST /setup/test-connection` | Tests the typed creds against `/rest/api/3/myself` |
| `GET /setup/detect-fields` | Catalogs the custom fields via `/rest/api/3/field` |

### Wizard `setup.html` (4 steps — NO connection)

The connection left the wizard (it lives in the `/connect` gate, see Layer 1). The
`/setup` wizard was reduced to **customization**:

1. **Boards / Projects** (QA required; bug/tech optional; arrays of boards)
2. **Custom fields** (with automatic detection of custom fields)
3. **Workflow + Confluence (toggle) + Branding + Interface text (labels)**
4. **Review and save**

## Config in 3 layers (connection / config / text)

The config was split into **three layers** with distinct responsibilities.

### Layer 1 — Secrets (connection)

- Live **ONLY in `.env`**: `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_TOKEN`, `PORT`.
- Requested at the **`/connect` gate** (`connect.html`), a **minimal** screen that
  appears ONLY at startup **if secrets are missing**.
- Endpoint **`POST /setup/secrets`** saves **only secrets**: upsert `.env` +
  **rebuild AUTH in memory**, **without restarting** the server.
- **Invariant**: the token is NEVER serialized to `/config.js` (`APP_CONFIG`).
- The **connection is NOT part of the configuration wizard** — it is a separate gate.

### Layer 2 — Structural config

- Lives in **`qa-config.json`** (gitignored): `boards` / `fields` / `workflow` /
  `confluence` / `issueTypes` / `branding` / `labels`.
- Edited in the **`/setup` wizard** (`setup.html`), now with **4 steps** (see above).
- **`POST /setup/save`** sends **only `{config}`** (no longer includes secrets) →
  validates and writes `qa-config.json`.

### Layer 3 — Configurable interface text (labels) — NEW

- `Server.JS` defines **`LABEL_DEFAULTS`** (**generic** defaults, without any
  organization's values) and **`resolveLabels()`**, which exposes them in
  **`window.APP_CONFIG.labels`**.
- The front-end uses the attribute **`data-label="key"`** in the HTML + the applier
  script **`labels.js`**, which replaces the element's text with the configured value.
  It also exposes **`window.Labels.get(key, fallback)`** for text generated by JS.
- **Current keys**: `reportBug`, `finalizeBug`, `finalizeTestCase`, `requiresConfig`.
- Each instance **overrides** them from `qa-config.json` → `labels`.
- Example: the default of `finalizeTestCase` is **"Finalizar caso"** (generic); an
  instance can override it to **"Finalizar TC"** or **"Finalizar QC"**, whatever its team uses.

Label precedence (same spirit as the rest of the config):

```
qa-config.json → labels  →  LABEL_DEFAULTS (generic)
```
