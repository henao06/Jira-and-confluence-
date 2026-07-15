# Architecture

## Server.JS (proxy + static server)

Pure Node.js HTTP server (no Express, no dependencies). ~737 lines.

### Responsibilities

1. **Serve static files** from the root directory with the right MIME types (.html, .js, .css, .png, .jpg, .ico)
2. **Proxy `/jira/*` → `https://<JIRA_HOST>/*`** (the host comes from `.env`, e.g. `tu-empresa.atlassian.net`):
   - Injects the `Authorization: Basic <base64(email:token)>` header
   - For POST/PUT to `/issue`: automatically injects the reporter email custom field (`fields.reporterEmail`, e.g. `customfield_10271`) and the displayName custom field (`fields.reporterName`, e.g. `customfield_10337`) when they are not present. The actual field IDs are resolved from config, not hardcoded.
3. **Pretty-path routing** (extensionless):
   - `/` → `Qa_form.html`
   - `/history` → `history.html`
   - `/jira-editor` → `jira_editor.html`
   - `/bg-verificacion` → `bg_verificacion.html`
   - `/actividades` → `actividades.html`
   - `/connect` → `connect.html`
   - `/setup` → `setup.html`
4. **Open CORS** (`*`) for development
5. **Cache-Control: no-cache** for `.js` (important: JS changes show up without a hard refresh)
6. **Serve `/config.js`**: builds a `CONFIG` object from `.env` and exposes it as `window.APP_CONFIG` (dynamic endpoint, not a file). This is what makes the app org-neutral — see `config.md`.

### The server always starts (DEFAULT_PORT)

The server is designed to **never crash for missing configuration**. It always boots so it can serve `/connect` and let the user generate the `.env` from the UX.

```js
const DEFAULT_PORT = 8080;
let PORT = Number.isInteger(parseInt(process.env.PORT, 10)) ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;
```

If `PORT` is missing or NaN, it falls back to `8080`. Even with no `.env` at all, the server comes up on port 8080 so the connection gate (`/connect`) can be reached and the `.env` written from the browser.

### Environment variables (at startup)

The app is configured entirely through `.env`. Minimum required for a fully working instance: `PORT`, `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_TOKEN`, `QA_PROJECT`. There are many more (projects, custom fields, epics, workflow, Confluence, branding) — **the full list with descriptions and the mapping to `APP_CONFIG` lives in `config.md`** and in `.env.example`.

- `JIRA_HOST` — Jira Cloud instance host (e.g. `tu-empresa.atlassian.net`)
- `JIRA_EMAIL` — Jira bot/user email
- `JIRA_TOKEN` — Atlassian API token
- `PORT` — port
- `QA_PROJECT` — test-case project key

**Fail-soft, not fail-fast**: unlike an earlier design, the server no longer refuses to start when config is missing. Instead it boots on `DEFAULT_PORT` and drives the user to the appropriate setup gate:

- **Missing secrets** (host/email/token) → any app route redirects to `/connect` (the minimal startup gate — only what's missing).
- **Missing config** (boards/fields not yet resolved, `setupRequired = true`) → app routes redirect to `/setup` (the personalization wizard, no connection needed).
- `/setup/*`, `/connect`, `/config.js`, `/jira`, and `/wiki` always pass through so the gates and the proxy keep working.

### Config resolution (resolveConfig)

`resolveConfig(raw)` turns the raw config (from `qa-config.json` / `.env`) into the object exposed as `window.APP_CONFIG`. Besides `jira`, `projects`, `fields`, `epics`, `workflow`, `confluence`, and `branding`, it resolves:

- **`boards`** — active board per type (`qa`, `bug`, `tech`), each with `id`/`name`/`projectKey` (no secrets). Used by `board-switcher.js`.
- **`issueTypes`** — the Jira issue types used when creating issues:

```js
issueTypes: {
  testCase: (raw.issueTypes && raw.issueTypes.testCase) || 'Tarea',
  techTask: (raw.issueTypes && raw.issueTypes.techTask) || 'Tech Task',
  options:  [ /* string list of selectable types */ ],
}
```

`APP_CONFIG.issueTypes` is used in the issue-creation payloads and to populate the "change issue type" menu in `history.html`. Defaults are Spanish-friendly (`'Tarea'`) but any org overrides them from `qa-config.json → issueTypes`.

### Custom field injection (important)

Around lines 594-599 of Server.JS:
```js
if (payload.fields) {
  const flds   = getConfig().config.fields;
  const fEmail = flds.reporterEmail;
  const fName  = flds.reporterName;
  if (fEmail && !payload.fields[fEmail]) payload.fields[fEmail] = JIRA_EMAIL;
  if (fName  && !payload.fields[fName])  payload.fields[fName]  = myDisplayName || JIRA_EMAIL;
}
```

The client does NOT set these. So if you see a POST and these fields appear in the payload, it's the server. The field IDs come from resolved config (`config.fields.reporterEmail` / `reporterName`), not from hardcoded `customfield_*` numbers.

### Setup / connection endpoints

Server.JS exposes a small API used by the two gates:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/setup/status` | GET | Current config/connection state (drives both gates) |
| `/setup/secrets` | POST | Writes ONLY the connection secrets (host/email/token) to `.env`. Used by `/connect`. |
| `/setup/test-connection` | POST | Validates the supplied credentials against Jira |
| `/setup/detect-fields` | GET | Auto-detects Jira custom field IDs |
| `/setup/save` | POST | Persists the full wizard config. Used by `/setup`. |
| `/setup/active-board` | POST | Switches the active board for a given type. Used by `board-switcher.js`. |

## General data flow

```
Client (Browser)
  │
  │  fetch('/jira/rest/api/3/issue', { method: 'POST', body: {...} })
  ↓
Server.JS
  ├─ injects Authorization
  ├─ injects reporter custom fields (configurable IDs, e.g. _10271 / _10337)
  └─ proxy → https://<JIRA_HOST>/rest/api/3/issue   (host from .env)
                  ↓
              Atlassian Jira Cloud
                  ↓
              Response → Client
```

## Startup / gate flow

```
node Server.JS  (always boots — DEFAULT_PORT 8080 if PORT is missing/NaN)
  │
  ├─ secrets missing?  → app routes 302 → /connect  (connect.html)
  │                         POST /setup/secrets → writes .env → reload
  │
  ├─ config missing (setupRequired)? → app routes 302 → /setup  (setup.html)
  │                         4-step wizard → POST /setup/save → reload
  │
  └─ fully configured → serves the app pages normally
```

## Structure of each HTML page

Typical pattern (Qa_form.html, bg_verificacion.html, etc.):

```html
<head>
  <script src="/config.js"></script>   <!-- ALWAYS first: defines window.APP_CONFIG -->
  <style>
    /* inline CSS — CSS variables in :root, layout, components */
  </style>
</head>
<body>
  <div class="page">
    <div class="hdr">…</div>  <!-- Header with nav buttons + board switcher -->
    <main>…</main>            <!-- Main content -->
  </div>

  <script src="/epic-filter.js"></script>     <!-- Shared modules -->
  <script src="/board-switcher.js"></script>
  <script src="/labels.js"></script>
  <script src="/icons.js"></script>
  <script src="/bulk-epic.js"></script>       <!-- (bg_verificacion only) -->

  <script>
    /* large inline JS — page functions */
    const JIRA_BASE = window.location.origin + '/jira';
    // ...
  </script>
</body>
```

## Shared external JS modules

| File | Exposes | Used by |
|------|---------|---------|
| `epic-filter.js` | `EpicFilter.init`, `setEpics`, `loadEpicsFromJira`, `getJqlClause`, `getIgnoredEpics` | bg_verificacion, history, jira_editor |
| `bulk-epic.js` | `bulkState`, `cargarBulkEpics`, `renderBulkEpicList`, `seleccionarBulkEpic`, `completarBulk`, `setBulkResultado`, `setBulkFinalizar`, `setBulkPrioridad`, `agregarImagenesBulk`, `quitarImagenBulk` | bg_verificacion (Bulk tab) |
| `releases.js` | Releases/versions functions | Qa_form, actividades |
| `bg_reporter.js` | Helper to report BG bugs | actividades |
| `icons.js` | `window.Icons` (`Icons.svg`) — SVG line-icon system | all 7 pages |
| `labels.js` | `window.Labels` (`Labels.get`) — configurable UI text | all 7 pages |
| `board-switcher.js` | `window.BoardSwitcher` (`BoardSwitcher.init`) — active-board selector | all app pages |

### icons.js — SVG line-icon system

IIFE that exposes `window.Icons`. A set of line SVG icons (Lucide-style) that replaces the old emojis, for a clean, commercial look. All icons use `currentColor` and inherit the font size via the `.ico` CSS class (defined in `styles.css`) unless you pass an explicit size.

Two ways to use it:

- **From JS-generated HTML** — `Icons.svg(name, { size, cls })` returns the `<svg>` markup:
  ```js
  el.innerHTML = Icons.svg('bug', { size: 14 });
  ```
- **In static HTML** — on load it auto-replaces any placeholder:
  ```html
  <span class="ico" data-icon="check"></span>
  ```

Included in all 7 pages. Available icons: `check`, `check-circle`, `x`, `settings`, `refresh`, `bug`, `alert`, `link`, `clock`, `star`, `external`, `plus`, `search`, `filter`, `list`, `edit`, `code`, `clipboard`.

### labels.js — configurable UI text

IIFE that exposes `window.Labels`. It replaces UI text via the `data-label` attribute, reading values from `APP_CONFIG.labels` (resolved by the server from `qa-config.json → "labels"`, with generic defaults). On load it walks the DOM and replaces the text of every element marked with `data-label="key"` with the configured value; `data-label-title` does the same for `title` attributes. Nothing is hardcoded — whoever installs the app sees the default and overrides it with THEIR board's name from the wizard.

- **In HTML**: `<span data-label="finalizeTestCase">Finalize case</span>`
- **From JS**: `Labels.get(key, fallback)` for text generated in JS (tooltips, dynamic strings, etc.).

### board-switcher.js — active-board selector

IIFE that exposes `window.BoardSwitcher`. It reads `APP_CONFIG.boards` (id/name/projectKey per type — `qa`, `bug`, `tech` — with no secrets) and shows the active QA board in the header plus a panel to switch it. On change it does `POST /setup/active-board` and reloads the page so every query uses the new board. All config comes from the JSON — nothing hardcoded.

```js
BoardSwitcher.init({ container: document.getElementById('board-switcher-container') })
```

## The two setup pages

### connect.html — connection gate (secrets)

Minimal connection screen. Appears at startup whenever the connection secrets are missing. It loads `/config.js`, reads `/setup/status`, lets the user test the credentials via `POST /setup/test-connection`, and finally `POST /setup/secrets` — which writes the `.env`. Once secrets exist, the user is routed onward (to `/setup` if config is still missing, or to the app if complete).

### setup.html — project configuration wizard (4 steps)

The personalization wizard, reachable at `/setup` once secrets exist. It never touches the connection itself; it configures the project. Four steps:

1. **Boards** — one board per type (qa / bug / tech) with project keys and epics.
2. **Fields** — auto-detects/sets the Jira custom field IDs (via `/setup/detect-fields`).
3. **Workflow / Confluence** — finalize transition, statuses, version prefix, and the optional Confluence integration.
4. **Summary** — review, then `POST /setup/save` persists everything and reloads the app.

## External JS dependencies

`bulk-epic.js` depends on globals defined by the inline script of bg_verificacion.html:
- `JIRA_BASE`, `versionActual`
- `esc()`, `mkH()`, `mkP()`, `mkRule()`
- `_parseJiraError()`

That's why bulk-epic.js can't run standalone — it needs its host page.

## Project configuration

No `package.json`. No `node_modules`. No build step.

The server runs with `node Server.JS` directly. It only needs Node 18+ (uses native `fetch`). Then open `http://localhost:8080` (or the `PORT` from `.env`).
