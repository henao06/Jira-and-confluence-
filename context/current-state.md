# Current state

> Last updated: 2026-07-15

## What we are working on

**Active feature**: "Bulk Epic" tab in `bg_verificacion.html` — bulk generation of an Epic's missing TCs.

**Status**: Functional, partially tested. Some fine-tuning remains pending based on real usage.

## Recent changes (reverse chronological order)

### 2026-07-15 — Commercial UX phase: icons, issue types, boot hardening
- **What**: a round of commercial-grade UX polish to make the tool presentable and org-neutral out of the box.
- **(a) Icon system (`icons.js`)**: line-style SVG icons (Lucide-style) that replaced the **116 emojis** across the 7 pages (**0 emojis remaining**). The front uses the `data-icon` attribute in the HTML + `Icons.svg()` for JS-generated icons, plus a shared CSS class `.ico`. One consistent, professional icon set instead of platform-dependent emoji glyphs.
- **(b) Issue-type config (`issueTypes`)**: `Server.JS` now exposes a configurable `issueTypes` object (`testCase` / `techTask` / `options`) fed from the wizard, replacing the hardcoded `issuetype:{name:'Tarea'}` scattered through the code. Each instance picks its own issue-type names.
- **(c) Boot hardening**: `DEFAULT_PORT=8080` — the server **starts without `.env`** (no crash on missing secrets/config; the fail-soft gates then route to `/connect` or `/setup`).
- **(d) Dead code removed**: deleted `cfg.js` (a dead file that still carried a hardcoded `APP_CONFIG`).
- **(e) Docs in English**: `README.md` and the docs were translated to English.

### 2026-07-15 — Phase 3: configurable labels + connection/config separation
- **What**: (a) a new **configurable UI text (labels) layer**; (b) **connection** was split from **configuration** into two separate gates.
- **(a) Configurable labels**: `Server.JS` defines `LABEL_DEFAULTS` (**generic** defaults, with no org-specific values) and `resolveLabels()`, which exposes them in `window.APP_CONFIG.labels`. The front uses the `data-label="key"` attribute in the HTML + the applier `labels.js` (replaces the element's text with the configured value) and `window.Labels.get(key, fallback)` for JS-generated text. Keys: `reportBug`, `finalizeBug`, `finalizeTestCase`, `requiresConfig`. Each instance overrides them from `qa-config.json` → `labels` (e.g. default `finalizeTestCase` = "Finalizar caso"; an instance can override it to "Finalizar TC").
- **(b) Connection/config separation**: the connection left the wizard. There is now a **minimal `/connect` gate** (`connect.html`) that appears ONLY on boot if secrets are missing; endpoint `POST /setup/secrets` saves **only secrets** (upsert `.env` + rebuild of AUTH in memory, **without restarting**). The `/setup` wizard was reduced to **customization**, now **4 steps** (Boards/Projects · Fields · Workflow+Confluence+Branding+Labels · Review and save); `POST /setup/save` sends **only `{config}`** (no longer includes secrets). The token is NEVER serialized to `/config.js`.
- **Fail-soft gates** (`Server.JS`): missing secrets → 302 to `/connect`; missing valid config → 302 to `/setup`; all ok → the app runs. Only the app pages are intercepted; static assets (css/js), `/config.js`, `/setup/*`, `/connect`, `/jira/*`, `/wiki/*` always pass. Config precedence: valid `qa-config.json` → used; missing/invalid → empty neutral config (`setupRequired=true`) → `/setup` wizard. **There is NO fallback via `.env` variables.**
- **Legacy fallback removed**: `resolveFromEnv`/`envBoardMeta` — `qa-config.json` is the **single source** of structural config; no JSON = **forced wizard**. `.env` now only holds connection secrets (`JIRA_HOST/JIRA_EMAIL/JIRA_TOKEN/PORT`); the old structural variables (`QA_PROJECT`, `FIELD_*`, `EPIC_*`, etc.) are obsolete and are **no longer read**.
- **Verified end-to-end**: fresh (no secrets) → `/connect` → `/setup` → the app runs; the token does not leak into `APP_CONFIG`/`config.js`.
- **New files**: `connect.html`, `labels.js`. **Edited**: `Server.JS`, `setup.html`, `qa-config.json` (+`labels` block), and the 5 HTML pages (`Qa_form.html`, `actividades.html`, `history.html`, `bg_verificacion.html`, `jira_editor.html`) with `data-label` and/or the `labels.js` include. Doc: `context/config.md` ("Configuración en 3 capas" section).

### 2026-07-15 — Phase 2: active-board selector in the header
- **What**: `board-switcher.js` (IIFE module, mirror of `epic-filter.js`) in the `.hdr-right` of the 5 pages. Shows the active QA board (name) and a panel to change the active one per type (QA/Bug/Tech) live.
- **How**: `Server.JS` exposes `APP_CONFIG.boards` (id/name/projectKey per type + activeBoardId, WITHOUT secrets or epics). New endpoint `POST /setup/active-board {type,boardId}` that updates `activeBoardId` in `qa-config.json`, validates and invalidates cache. On change, the switcher reloads the page → `/config.js` re-resolves the active one → the ~70 queries use the new board. **Nothing hardcoded: everything comes from the JSON.**
- **Profiles (one active at a time)**: you define N boards in the wizard, the header changes which one is active. No cap.
- **Files**: `board-switcher.js` (new), `Server.JS` (boardMeta/envBoardMeta + `boards` in resolve + endpoint), the 5 HTML files (include + `#board-switcher-container` + `BoardSwitcher.init`).

### 2026-07-15 — Phase 1: Setup Wizard + JSON config layer
- **What**: first-boot wizard (`setup.html`, 5 steps) + a JSON config layer (`qa-config.json`). The app is now configured **org-neutral from the browser UI**, without editing files by hand.
- **Why**: make setup easy, fast and intuitive — any org configures the tool from a screen (Connection with test, Boards, Fields with detection, Workflow/Confluence/Branding, Review+Save) instead of editing `.env` blindly.
- **Config precedence** (`Server.JS`, in its original Phase 1 form): valid `qa-config.json` → legacy `.env` fallback → neutral defaults. **(Obsolete — see the Phase 3 entry: the legacy fallback `resolveFromEnv`/`envBoardMeta` was removed; today no valid JSON = forced wizard, with no reading of structural `.env` variables.)**
- **`qa-config.json`** (gitignored, generated by the wizard, **WITHOUT secrets**): structural config with `boards` as **arrays** (1 or N, no cap) and `activeBoardId` per type; QA required (≥1 item with `projectKey`), the rest optional; the epics live in the active QA board. `Server.JS` flattens it to the same `window.APP_CONFIG` as always via `resolveConfig()` — the ~70 front consumers did NOT change.
- **Fail-soft** (replaces the old 503): if secrets are missing or `qa-config.json` is missing/invalid, the server does a **302 → `/setup`** (allowlist `/setup`, `/setup/*`, `/config.js`, `/jira/*`, `/wiki/*`). There is no longer a dead 503 page.
- **Secrets**: `JIRA_HOST/JIRA_EMAIL/JIRA_TOKEN/PORT` stay ONLY in `.env`; the token is NEVER serialized into `APP_CONFIG` nor `qa-config.json`. Hot-reload of `/config.js` by `mtime` (without restarting, except on a `PORT` change). New endpoints: `GET /setup/status`, `POST /setup/save`, `POST /setup/test-connection`, `GET /setup/detect-fields`.
- **Key files**: `Server.JS`, `setup.html`, `qa-config.json`, `.gitignore`, `context/config.md` (see the "Setup wizard + qa-config.json (Fase 1)" section).
- **Note**: live multi-board (header selector to change the active board without re-saving) is left for **Phase 2**.

### 2026-07-15 — Responsive: tablet + phone (down to ~360px)
- **What**: the whole app (5 screens) was made responsive for tablet and phone, not just desktop.
- **Shared foundation (`styles.css`)**: `.hdr` with `flex-wrap` (avoids nav overflow in the tablet band), utility `.table-scroll` (horizontal scroll for wide content), `@media (max-width:820px/560px)` for the header, `@media (pointer:coarse)` for minimum touch targets (40px), and a fix for the `--g3`/`--g5` variables that were undefined.
- **Per-page reflows** (media queries in the inline `<style>`; desktop unchanged, everything gated):
  - `history.html`: 12-column table wrapped in `.table-scroll`; on phone 2 low-priority columns are hidden (Prioridad, Fecha) and the popover is contained to the viewport.
  - `bg_verificacion.html`: collapses `.bulk-layout` (fixed 320px sidebar → 1 column) and the `.two-col` board; fix of `calc(100vh-…)` heights. **"→ Mover a la cola" button** on each pending card: HTML5 drag&drop does NOT work on touch, so this button calls `addToQueue(key)` (same function as the drop) as a touch alternative.
  - `actividades.html` / `jira_editor.html`: fixed selects become full-width, flex rows wrap.
  - `Qa_form.html`: no own `<style>`, covered by the shared foundation.
- **Breakpoints**: the existing ones were reused (640px main, 720px board) + 480px for small phones. Coherence, not a parallel system.
- **Pending (Level 2, for the scaling phase)**: the board still has no real touch drag&drop (only the fallback button); a full touch-DnD is a separate JS change.
- **Files**: `styles.css`, `history.html`, `bg_verificacion.html`, `actividades.html`, `jira_editor.html`.

### 2026-07-15 — Neutralization: org-neutral app via externalized config
- **What**: EVERYTHING org-specific was pulled out of the code (Jira domain, project keys QAA/BG/SP, epics QAA-172/QAA-179, custom field IDs, transition IDs, version prefix, branding). Everything now comes from `.env`.
- **Why**: make the tool reusable by any organization without touching code — just configure `.env`.
- **New config system** (see `context/config.md` — full reference doc):
  - `Server.JS` builds a `CONFIG` object from `.env` and serves it at `GET /config.js` as `window.APP_CONFIG` (grouped into: `jira`, `projects`, `fields`, `epics`, `workflow`, `confluence`, `branding`).
  - Each HTML loads `/config.js` as the **first `<script>` in the `<head>`**; the front-end reads from `APP_CONFIG` instead of hardcoding.
  - **Fail-fast**: if `PORT`/`JIRA_HOST`/`JIRA_EMAIL`/`JIRA_TOKEN`/`QA_PROJECT` is missing, the server serves a 503 config-error page and does not start.
- **Expanded `.env` schema** (see `.env.example`): `QA_PROJECT, BUG_PROJECT, TECH_PROJECT, FIELD_REPORTER_EMAIL, FIELD_REPORTER_NAME, FIELD_CATEGORY, FIELD_EPIC_LINK, FIELD_BG_DEPENDENCY, EPIC_VERIFICATION, EPIC_ACTIVITIES, TRANSITION_FINALIZE, STATUS_BUG_UNDER_REVIEW, VERSION_PREFIX, CONFLUENCE_HISTORY_PAGE_ID, CONFLUENCE_SPACE, ORG_NAME, APP_NAME` (+ the originals `PORT, JIRA_HOST, JIRA_EMAIL, JIRA_TOKEN`). Empty optional = feature off.
- **Key files**: `Server.JS` (CONFIG object + `/config.js` endpoint + fail-fast), all HTML and shared `.js` (now read `APP_CONFIG`), `.env` / `.env.example`, `context/config.md` (new).
- The QAA/BG/SP and QAA-172 style values that appear in the rest of the docs remain **examples**, not fixed facts.

### 2026-06-17 — Qa_form.html + actividades.html: video preview in attachments
- The attachment/evidence inputs already had `accept="*/*"` (videos could always be UPLOADED). The gap was the preview: a video showed as a generic icon.
- Now the previews detect `video/*` and render a `<video controls muted playsinline preload="metadata">` (playable inline). Applies to: new uploads (`renderPreviews` in both) and existing attachments on re-open (evidence + linked BG in Qa_form).
- `styles.css`: `.preview-item video` rule twinned with `.preview-item img` (90×72, black background).
- Qa_form paste handler: besides `image/*` it now accepts pasted `video/*` (name `video-<ts>.<ext>`).
- Caveat: Jira has an attachment size limit (default ~10MB, admin-configurable); large videos may be rejected by the server, not by the form.
- Files: `Qa_form.html`, `actividades.html`, `styles.css`.

### 2026-06-17 — bg_verificacion.html: auto-cleanup of the Queue on reload
- On changing a card's status in the Queue (transition select), the `item.bgTransitionAplicada` flag was already set. Now, in `cargarPendientes` (Reload), the Queue cards with `bgTransitionAplicada` that are **no longer in the filter result** are removed on their own — they do not reappear in Pendientes or Cola ("no longer mine").
- `removeFromQueue(key, volverAPendientes = true)`: new second parameter. The cleanup uses `removeFromQueue(key, false)` to NOT return the item to Pendientes.
- Applies to BG and SP. Known edge: the filter brings `maxResults: 50`; if there were >50 matches, an item with a changed status beyond page 1 could be cleaned up even if still in the filter (a realistic verification queue is small).
- File: `bg_verificacion.html`.

### 2026-06-17 — bg_verificacion.html: verification flow generalized to SP
- The "Mis tareas TECH" (SP) filter is no longer read-only: it now has the **full Pendientes → Cola → evidence in QAA-172 flow**, same as BG (the read-only decision was reverted).
- `proyectoFiltroActivo()` reads the target project from the active JQL; `esModoVerificacion()` now enables the Queue for **BG and SP** (any other filter stays read-only).
- Traceability labels **derived from the source project** (not hardcoded): `verificacion-<proj>` + `<proj>-<key>` (e.g. `verificacion-sp`, `sp-sp-12`). Affects `sincronizarSubtareaQAA` (baseLabels) and `buscarSubtareaQAAExistente` (labelKey).
- `EpicFilter.getJqlClause()` (module exclusion) is only applied if the filter is BG.
- Cosmetics generalized to the project prefix: `buildDescription` ("Detalles del origen", "Estado" with the real status instead of the fixed "Under Review"), preview modal, status label in the queue card ("SP (estado):").
- `abrirRetest`: routes to /bg-verificacion for any `verificacion-*` label (previously only `verificacion-bg`).
- The "Agregar tarea en BG" sub-feature of the queue card is **hidden** if the filter is not BG.
- `sincronizarSubtareaQAA` was already nearly generic (uses `issue.key`); the rest of the flow (create QAA child, links, attachments, transition) works the same for SP.
- File: `bg_verificacion.html`.

### 2026-06-17 — bg_verificacion.html: multi-filter selector from the epic
- The "Pendientes" column now has a **filter selector** (`#filtro-selector`) populated from the QAA-172 epic description. It is hidden if there is a single filter.
- The parser moved from `extraerJqlDeADF` (first block) to **`extraerFiltrosDeADF`**: it takes each code block with `project` whose **immediately preceding ADF node is a heading**. The heading gives the filter name. This way the JQLs in the "Métricas" section (preceded by text, not a heading) stay out of the selector.
- State: `filtros[]` + `filtroActivoIdx`; `jqlActivo()`; `esModoVerificacion()` = the active JQL points to `project = BG`.
- **View mode (non-BG filter)**: `aplicarModoVista()` hides the "Cola QAA" column (`#cola-qaa-col`), the list takes the full width, and `makePendingCard` early-returns (read-only card: no drag, no "Cambiar estado"). The `EpicFilter.getJqlClause()` clause is only applied in BG mode.
- **Epic QAA-172 (edited live)**: in the description `### Filtro JQL:` was renamed → `### Verificación BG` and `### Mis tareas TECH` was added with `project = SP AND assignee = currentUser() ORDER BY cf[10019] ASC`. Convention: each selector filter = `###` heading + code block immediately below.
- WATCH OUT: `currentUser()` resolves to the owner of the token Server.JS injects. If that token is not the user's personal account, the TECH filter will not show "their" tasks → in that case use the fixed accountId.
- Files: `bg_verificacion.html` + the QAA-172 description in Jira.

### 2026-06-17 — actividades.html: dual BG + TECH (SP) reporting
- Checkbox "🐛 Reportar como bug en BG" renamed to "🐛 BG"; new checkbox "🛠️ TECH" added.
- TECH creates a **Tech Task** in the **SP** project (LPV Tech, id 10303, cloudId d4aeb06d-33c0-40d9-b9c1-ed860026cfcf), linked to the QAA with a `Relates` link, same panel/report-style description as BG.
- You can mark BG, TECH, both, or neither. The `result-box` shows the links according to what was created (QAA always · BG in red · Tech SP in blue).
- Fields panel (Assign to / Version / Environment) **shared**: appears if BG or TECH is checked. `bg_reporter.js` now loads assignables via `user/assignable/multiProjectSearch?projectKeys=...` (intersection of the active projects).
- `bg_reporter.js`: creation logic generalized into `_crearReporteIssue()`; `crearBugBG` (BG) and `crearTechSP` (SP) are wrappers. `toggleBgAssignee()` no longer receives `chk` (it reads the checkboxes). `bgUsersLoaded` removed → replaced by `_assigneeKey`.
- **Issue type per board**: each project has its own issuetype catalog (QAA/BG: Tarea·Historia·Error; SP: Tarea·Tech Task·Feature·Error). Previously a single selector served QAA+BG (latent bug: it worked only because they share a catalog). Now there is a selector per active board: `tipo-actividad` (QAA, always), `bg-tipo` (appears with BG, default `Error`), `tech-tipo` (appears with TECH, default `Tech Task`). `loadTiposActividad` was generalized into `loadTiposProyecto(projectKey, selId, preferido)` which filters level-0 non-subtask from `/project/{key}`. `crearTechSP` now respects `opts.tipo`.
- Files: `actividades.html`, `bg_reporter.js`.

### 2026-06-02 — MCP server INSTALLED and functional (Python)
- `pip install -e .` run in `/home/sebastian/QA/mcp-confluence/.venv/`
- Dependencies installed: mcp 1.27.2, httpx 0.28.1, python-dotenv 1.2.2 + transitives (pydantic, starlette, uvicorn, jsonschema, etc.)
- Command `confluence-mcp` available at `.venv/bin/confluence-mcp`
- 29 tools verified (FastMCP registered them correctly on module import)
- Still needed to run: create `.env` with a real CONFLUENCE_TOKEN (the user must fill it in manually — the .env file is protected by Claude's permissions)

### 2026-06-02 — Confluence MCP server (Python, standalone)
- New directory `/home/sebastian/QA/mcp-confluence/`
- Files:
  - `pyproject.toml` — dependencies (mcp, httpx, python-dotenv) + entry point `confluence-mcp`
  - `env.example.txt` — .env template (rename to .env and fill in the token)
  - `confluence_mcp/__init__.py` — package init
  - `confluence_mcp/client.py` — HTTP client with Basic auth, supports v1 (/wiki/rest/api) and v2 (/wiki/api/v2)
  - `confluence_mcp/server.py` — MCP server with 25+ tools (FastMCP)
  - `README.md` — installation, config for Claude Desktop / Claude Code / Cursor / Cline
- Tools included:
  - **Pages** (9): search_pages, get_page, get_page_by_title, create_page, update_page, append_to_page, delete_page, list_page_versions, get_page_children
  - **Spaces** (4): list_spaces, get_space, list_space_content, get_space_id_from_key
  - **Attachments** (3): list_attachments, upload_attachment, delete_attachment
  - **Comments** (3): list_comments, add_comment, delete_comment
  - **Labels** (3): get_page_labels, add_page_labels, remove_page_label
  - **Whiteboards** (4): list_whiteboards, get_whiteboard, create_whiteboard, delete_whiteboard (v2 API)
  - **Users** (2): get_current_user, search_users
  - **CQL** (1): cql_search (raw CQL)
- Documented limitations: the INTERNAL content of whiteboards (shapes, sticky notes) is not editable via the public REST — only the container is created/deleted

### 2026-06-01 — history.html: edit issuetype inline
- Added the ability to change the task type (issuetype) directly from the history table
- Changes:
  - `issuetype` added to the fields fetch in the 3 JQL spots (main search + paginations)
  - In each Issue cell row: compact pill with the issuetype name (Tarea/Subtarea/Historia/Error/Epic) + `↕` button below the key
  - New function `openIssuetypePicker(event, key)` with 4 options (Tarea, Historia, Error, Subtarea) — pattern cloned from `openEstadoPicker`
  - New function `applyIssuetypeChange(key, name)` that does a PUT `/issue/{key}` with `fields: { issuetype: { name } }`
  - Error handling with alert if Jira rejects (e.g. changing to Subtarea without a valid parent)
- New CSS: `.p-it-tarea`, `.p-it-subtarea`, `.p-it-historia`, `.p-it-error`, `.p-it-epic` with the project palette

### 2026-05-28 — Reason/session defaults that go to Confluence (patch)
- Found 3 Spanish strings I had NOT translated in the first pass because they were default VALUES (not labels):
  - `iniciarSesion(motivo = 'Nueva sesión')` → `'New session'` — used if the flow calls without an argument
  - `iniciarSesion(motivo.trim() || 'Nueva sesión')` → `'New session'` — prompt fallback
  - `ejecutarPublicacion`: `'Sin motivo'` → `'No reason provided'` (motivo) and `'Nueva sesión'` → `'New session'` (motivoSig)
- These defaults propagate to the Confluence page when the user writes nothing in the modal
- Now the report comes out 100% in English except for what the user types (reason/observations) and the issues' original summaries (Jira data)

### 2026-05-28 — Confluence content translated to English
- All the text that `releases.js` generates for Confluence is now in English
- Kept in Spanish: internal function names, code comments, the local publish modal (app UI)
- Main changes:
  - Date format: `'es-CO'` → `'en-US'`
  - Info macro title: `Sesion QA` → `QA Session`
  - Labels: `Versión/Fecha/Modulos cubiertos/Motivo de cierre/BG Bugs reportados` → `Version/Date/Modules covered/Closing reason/BG Bugs reported`
  - `Ninguno en esta sesion` → `None in this session`
  - Status badge fallback: `Pendiente` → `Pending`
  - Severity labels (Critico/Mayor/Medio/Menor/Bajo) → `Critical/Major/Medium/Minor/Low`
  - Column headers: `Actividades/Vinculados/Tasa` → `Activities/Linked/Rate`
  - Module table headers: `Resumen/Estado/Prioridad/Asignado` → `Summary/Status/Priority/Assignee`
  - `EPIC_LABELS`: `Verificacion BG` → `BG Verification`, `Actividades y Sugerencias` → `Activities and Suggestions`
  - `Sin modulo` → `No module`
  - Section titles: `Desglose por Modulo` → `Module Breakdown`, `Cadena de Re-tests` → `Re-test Chain`, `Requiere Configuracion de Servidor` → `Server Configuration Required`, `Sin cambios de configuracion` → `No configuration changes`, `Observaciones del QA Senior` → `Senior QA Observations`
  - Inline messages: `Ver todos en Jira` → `View all in Jira`, `Coordinar con infraestructura antes del despliegue` → `Coordinate with infrastructure before deployment`, `El servidor no requiere ajustes adicionales para esta version` → `The server requires no additional adjustments for this version`
  - Page title: `Historial de Versiones Publicadas` → `Published Versions History`
- IMPORTANT: Changing the `title` in the PUT to Confluence **renames** the existing page (on the next publish). To keep the old title for compatibility, revert only that line.

### 2026-05-27 — onTestCaseChange: full auto-fill + residual reset
- In `Qa_form.html` function `onTestCaseChange()`:
  - Added a RESET block at the start that clears everything residual from the previous TC:
    - estado / severidad / frecuencia (vars + buttons .e-btn/.sev-btn)
    - row-severity, row-frecuencia (visibility)
    - checkboxes: reportar-bug, requiere-config, registrarEnBG, registrarEnQAAFinalizada
    - bg-assignee-wrap (visibility)
    - uploadedFiles + configFiles (with re-render)
    - obtenido-wrap, soluc-wrap, sugg-wrap (rebuild to a single empty row)
  - Added `setVal('url-pantalla', tc.urlPantalla)` that was missing — already documented in the schema (jira_editor.html)
- Preserves: module, tester, date, version (global things that do not change between TCs)
- Trigger: on selecting another TC from the select, no traces of the previous one remain

### 2026-05-27 — QA_STRUCTURE schema audit + doc fix
- Verification: every field of the example in jira_editor.html (schema hint) IS used in the code
- Found ONE field used but not documented: `tc.urlPantalla` (read by bulk-epic.js:_buildTCDescription → "URL / Pantalla" row)
- Fix: added to the jira_editor.html schema hint with the comment "opcional → URL clickeable en la tabla de identificación"
- The rest of the schema confirmed correct

### 2026-05-26 — Confluence summary: links + remove duplicate columns
- In `agregarAlHistorialConfluence`:
  - Removed the **Version** column from the metrics table (already in the macro title and the 1st line of the body)
  - Removed the **Fecha** column (idem, already in the body)
  - The table now starts directly with Total | Pass | Fail | Blocked | Retest | Actividades | Vinculados | Tasa
  - Body of the summary got a "Versión: <link>test-v003</link>" line — link to the QAA project release page
  - "BG Bugs reportados: N" → the N is now a clickable link to JQL `key in (...)` with all reported bugs
- New URLs:
  - releasesUrl: `${JIRA_UI}/projects/QAA?selectedItem=com.atlassian.jira.jira-projects-plugin%3Arelease-page&status=no-filter`
  - bgBugsJqlUrl: uses `key in (BG-XX,...)` with the bgIssues.key list

### 2026-05-26 — Fix pagination in obtenerDatosVersion (releases.js)
- BUG: the publish-version modal showed Total=100, but the history filter showed 118
- ROOT CAUSE: the code used `startAt += 100` and `d.total` to paginate. The new Jira Cloud `/search/jql` API:
  - **Ignores `startAt`** (always returns the first page)
  - **Does not return `total`** (it is `undefined`)
- Since `d.total = undefined`, `allIssues.length >= 0` was always true → it left the loop after the first page with 100 issues
- FIX: switch to `nextPageToken` + `isLast` (same as history.html). It is the correct mechanism of the new API.
- Validated: test-v003 now returns 118 issues (100 + 18 on the second page)
- Impacts: Total / Pass / Fail / Blocked / Retest / Tasa / Actividades / Vinculados — all the Confluence report metrics

### 2026-05-26 — "Vinculados" column in the Confluence table
- New column between Actividades and Tasa in the report metrics table
- In `obtenerDatosVersion`: new block that does 2 fetches
  - GET QAA-172?fields=issuelinks → extracts BG keys linked to the Epic
  - JQL `key in (linked) AND labels = "{version}"` → crosses by version label
  - Result: `stats.vinculados` (count) + `stats.vinculadosKeys` (array)
- In `agregarAlHistorialConfluence`: new column with purple color (#7c3aed) and link to JQL `key in (...)` to open those BGs in the Jira UI
- No emojis (as requested)
- Validated: test-v003 → 9 linked (the 10 of the Epic, minus BG-117 which is from a previous version)

### 2026-05-26 — Combined Enlazadas + Version filter (history.html)
- Prior investigation (via curl): 9 of 10 BGs linked to the Epic already had label `test-v003`, BG-117 had `test-v002` (previous version). 25 total BGs with label test-v003 overall.
- Mod in `buildJQL`: when `f-enlazadas` is active AND there is a version in `f-version`, it adds `AND labels = "{version}"` to the JQL. This combines linked-to-Epic with version without fighting `project=QAA` (which stays disabled).
- Validated via curl:
  - Only linked → 10
  - Linked + test-v003 → 9
  - Linked + test-v002 → 1 (BG-117)

### 2026-05-26 — bg_verificacion: add version label to the BG
- DISCOVERY: the BG project has no versions defined (versions are per-project in Jira, not global). That is why BGs were not "associated" with the QA cycle version.
- Decision: instead of `fixVersions` (which would require admin to create the version in the BG project), we use a LABEL on the BG with the same name as `versionActual` (e.g. "test-v003")
- In `sincronizarSubtareaQAA`: after creating/updating QAA and the BG description, it now also:
  - Reads the BG's `labels` (new field in the existing fetch)
  - If `versionActual` is not present as a label, adds a new label and PUTs
- Idempotent: skip if the label is already there
- Benefit: allows filtering BGs by version in history.html (via `labels = "test-v003"`) and grouping them in Confluence reports

### 2026-05-26 — buildJQL: short-circuit when f-enlazadas active
- v6 brought the 10 BG keys correctly, but buildJQL combined them with other QAA-specific filters (fixVersion=test-vN, project=QAA) that filtered the BGs out
- Fix: when `f-enlazadas` is active, buildJQL **short-circuits** and returns ONLY `key in (...) ORDER BY created DESC`, ignoring all other filters
- If the user wants to combine with other filters, they must uncheck this checkbox (trade-off documented in the code)
- Validated: 10 BGs visible in the table with real summaries

### 2026-05-26 — fetchEnlazadasKeys: v6 = simple, returns ALL linked
- The user wanted to filter ALL linked Activities (including BG-, not just QAA-)
- Removed the two-hop: back to a single request
- `fetchEnlazadasKeys` now returns all keys of QAA-172's `issuelinks` field (without prefix filtering) except QAA-172 itself
- `buildJQL` adjusted: when `f-enlazadas` is active, it removes `project = QAA` from the base. The `key in (...)` already limits the universe
- Validated via curl: 10 keys (all BG- in this Jira)

### 2026-05-26 — fetchEnlazadasKeys: v5 with two-hop (DISCARDED)
- Iterations of the `#f-enlazadas` checkbox in `history.html`:
  - v1: walk of ALL paginated BGs (slow)
  - v2: JQL `linkedIssues("QAA-172", "relates to")` — returned 0
  - v3: `GET /issue/QAA-172?fields=issuelinks` filtering QAA — returned 0
  - v4: same as v3 without type filter — still 0
  - **v5 (current)**: two-hop lookup
- Key DISCOVERY (via direct curl to the proxy server): QAA-172 has NO links to QAAs. Only to BGs (10 BGs, coming from the "Agregar al Epic" checkbox)
- The Relates QAA-task ↔ QAA-172 link mentioned in the bg_verificacion.html comment IN PRACTICE is NOT created (or was deleted). The POST may be failing silently
- v5 does:
  - Hop 1: GET /issue/QAA-172?fields=issuelinks → extracts BG keys
  - Hop 2: Promise.all() of GETs to each BG → extracts QAA keys from their issuelinks
- 1 + N requests but all parallel. Total ~1-2s
- Validated: 10 BGs → 7 unique QAAs (verified via `node` + curl)

### 2026-05-26 — "Actividades" column in the Confluence table
- In `releases.js` (`obtenerDatosVersion`): added `actividadIssues = allIssues.filter(i => i.fields.parent?.key === 'QAA-179')` and `stats.actividades`
- In `agregarAlHistorialConfluence`: new "Actividades" column between Retest and Tasa, with a clickable count that links to JQL `parent = QAA-179` filtered by version
- Blue color (#0369a1) to distinguish it from the other metrics
- The activities already appeared in `total` and in `byModule` (under QAA-179), but invisible in the metrics summary — now they show

### 2026-05-26 — Create the `context/` structure and `CLAUDE.md`
- Established the project's master documentation in `/home/sebastian/QA/context/`
- Created `/home/sebastian/QA/CLAUDE.md` as the automatic entry point for Claude
- Obligation: read context/ at the start of each session, update after significant changes

### 2026-05-26 — Clickable links in the bulk ADF description
- In `bulk-epic.js`, the "Identificación del Test Case" table now links:
  - Módulo → Epic in Jira (browse)
  - Versión → QAA releases page
  - Historia → autodetect: if a Jira key → browse, if a URL → URL, else plain text
  - URL / Pantalla → if a URL, link
- New helpers in bulk-epic.js: `_esJiraKey`, `_esUrl`, `_mkLinkText`, `_mkTableCellLink`, `_mkTableRowLink`, `_mkTableRowSmart`
- Constants: `_JIRA_BROWSE`, `_JIRA_VERSIONS`

### 2026-05-26 — Remove the "Resultado" panel from the bulk ADF
- In `_buildTCDescription` of `bulk-epic.js`, removed the panel with heading "Resultado" + "Estado: Pass" + tc.impacto
- Reason: the user did not want to see "Los usuarios no pueden..." in the description (it came from the `impacto` of the structure JSON)
- The pass/fail state is reflected only in the issue's **labels**

### 2026-05-26 — Banner with links of created issues
- After bulk creation, the banner now shows each created issue as a link: `TC-01 → QAA-200`
- Individual errors below if any
- Changed from `textContent` to `innerHTML` (all escaped with `esc()`)

### 2026-05-26 — Fix priority 400 + Priority select
- `tc.prioridad` from the structure JSON could bring any value → Jira rejected it
- Solution: add a Priority SELECT in the bulk form (Medium / Highest / High / Low / Lowest), same as Qa_form
- `bulkState.prioridad` replaces the use of `tc.prioridad` in the POST
- Removed the helper `_normalizarPriority` (unnecessary with the select)

### 2026-05-26 — "Finalizar en QAA" button → FN QAA checkbox
- Replaced the purple "Finalizar en QAA" button with a checkbox with class `checkbox-label`
- Works like Qa_form's `registrarEnQAAFinalizada`: on check + Generate, it transitions each created TC to Finalizada
- `bulkState.finalizar` (boolean) controls the behavior

### 2026-05-26 — Rewrite bulk to filter like `missing-panel`
- Fundamental change: the bulk now does not show "non-Done QAA tasks", but **TCs defined in `estructura.testCases` that do NOT have an issue yet**
- Same algorithm as `missing-panel` in history.html
- Builds an ADF description identical to Qa_form (info panel → table → preconditions → data → steps → expected → obtained → postconditions)
- POST to `/issue` with parent=epic, customfield_10014=epic, labels, fixVersion, etc.

### 2026-05-26 — Extract bulk to `bulk-epic.js`
- Moved all the bulk-mode logic out of bg_verificacion.html into a separate file
- Included via `<script src="/bulk-epic.js"></script>` in the head
- Depends on host globals (JIRA_BASE, esc, mk*, etc.)

### 2026-05-26 — Tab system → header buttons
- Instead of a separate tab bar, the two modes are buttons in `.hdr-right`: "Verificación" and "Bulk Epic"
- Style `btn-hdr-history` + `btn-hdr-tab.active` with a green gradient
- `cambiarTab(name)` uses selector `[data-tab]` (universal)

### 2026-05-26 — Idempotent checker in sincronizarSubtareaQAA
- Major change in bg_verificacion.html: `crearSubtareaEnQAA` → `sincronizarSubtareaQAA`
- Looks up an existing subtask by label `bg-{key}` (JQL) or issueLinks (fallback)
- If it exists: PUT only the diff (description, priority, labels, fixVersions, summary)
- Attachments: diff by filename, copies the missing ones
- Links: checks with `_existeLink` before creating
- BG description: checks with `_adfContieneKey(adf, qaaKey)` before appending
- Retry without priority if the PUT returns 400 (because the edit screen does not accept priority)
- Blue badge `↻ Actualizada` vs green `✓ Creada`

### Earlier — Real-time BG state changes
- The `BG:` select on each queue card now POSTs to `/transitions` in real time on change
- Flag `item.bgTransitionAplicada` avoids a double transition on submit
- Label shows the current status: `BG (Under Review):` → on change → `BG (Done) ✓`

### Earlier — Unify GET in addToQueue
- Before: 2 fetches (transitions + issuelinks)
- Now: 1 fetch with `?fields=status,issuelinks&expand=transitions`
- Also brings the BG's current status to show it in the label

### Earlier — Clickable badge-key
- The `<span class="badge-key">` (BG-123, QAA-XX) are now `<a>` with a link to Jira
- `target="_blank"` + `rel="noopener noreferrer"` + `event.stopPropagation()` (for drag)

## Known bugs / TODOs

- [ ] **Partial idempotency in bulk**: `_buildTCDescription` always creates from scratch. If the same TC is generated again (forcing via label match), the issue is duplicated. Mitigated because the `missing` filter already skips TCs with an existing issue — but if the version changes, it could duplicate.
- [ ] **Severity/Frequency in Bulk**: not applied when it is "Fail". The bulk flow loses that info that Qa_form does have.
- [ ] **Auto-create BG bug on bulk Fail**: the bulk does not create BG bugs when it is Fail (unlike Qa_form with the "reportar-bug" checkbox). Add it if needed.
- [ ] **User link in "Tester"**: currently "QA Bulk" plain text. If the accountId is obtained, it could link to `/jira/people/{accountId}`.

## Files modified in this session

- `bg_verificacion.html` — multiple (real-time, idempotency, badge-key links, tab header, CSS tabs, CSS checkbox-label)
- `bulk-epic.js` — created and rewritten several times (missing filter, ADF builder, priority select, FN QAA checkbox, banner with links, ADF links)
- `CLAUDE.md` — created
- `context/` — created in full

## Things not to forget for the next session

1. **Hard refresh** after touching JS — the server sets `Cache-Control: no-cache` but just in case
2. **versionActual** is auto-detected only in bg_verificacion.html — if it breaks, the logic is there
3. **Custom fields 10271 and 10337** are injected by Server.JS, do NOT send them from the client
4. **Priority in PUT** usually fails — retry without priority is the pattern
5. **Empty ADF orderedList** is rejected by Jira — always with at least one item

## To update this file

After any significant change:
1. Add a new entry at the top of "Recent changes" with the date
2. Move completed items from TODO to "Recent changes"
3. Add new bugs to "Known bugs / TODOs" if any
4. Update the "Last updated" header with today's date
