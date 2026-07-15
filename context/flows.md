# User flows

## 0. First-boot flow (no `.env` / no config)

**Purpose**: get a fresh install to a working state without editing files by hand. The app **never crashes** for missing config — it always starts (on port `8080` by default) and routes the user to the right gate.

**Steps**:
1. **No `.env` (missing secrets)** → the server redirects to the `/connect` gate (`connect.html`). The user loads the connection secrets there; `POST /setup/secrets` writes the `.env` (upsert) and rebuilds AUTH in memory **without restarting**.
2. **No valid config** → the server redirects to the `/setup` wizard (4 steps: Boards/Projects · Fields · Workflow+Confluence+Branding+Labels · Review and save). `POST /setup/save` writes `qa-config.json`.
3. **Everything ok** → the app runs.

**Guarantee**: the server boots even with neither `.env` nor `qa-config.json`. The gates are fail-soft: missing secrets → 302 to `/connect`, missing/invalid config → 302 to `/setup`, all ok → the app runs. Only app pages are intercepted; static assets, `/config.js`, `/setup/*`, `/connect`, `/jira/*` and `/wiki/*` always pass through.

## 1. Qa_form.html (route `/`) — Run a TC manually

**Purpose**: the QA runs ONE test case and records the result in Jira.

**Steps**:
1. Select module (Epic) → the configured TCs load
2. Pick a TC from the select → auto-fills preconditions, steps, expected, etc.
3. Fill in the obtained result, mark Pass/Fail/Blocked
4. If Fail: severity, frequency, impact
5. Optional: attachments, requires-config, report-bug, FN BG, FN QAA
6. Click "Enviar a Jira"

**Output**:
- 1 issue in QAA with a complete ADF description
- (If Fail + report-bug) 1 issue in BG linked via issueLink
- (If FN QAA) the QAA issue transitioned to Finalizada (transition id 31)
- (If FN BG) issue duplicated in BG, also Finalizada

**Edit mode**: if navigated with `?key=QAA-XX`, the form is filled with the issue's data and submits with PUT instead of POST.

## 2. bg_verificacion.html (route `/bg-verificacion`)

Page with TWO tabs in the header (nav buttons):

### Tab "Verificación BG" (default)

**Purpose**: the QA reviews bugs reported in BG (status `Under Review`), verifies them, and creates/syncs a Task in QAA under the Epic `QAA-172`.

**UI**:
- Left column "Pendientes": BG bugs in Under Review state, draggable
- Right column "Cola QAA": bugs dragged here, each with a verification form

**Steps**:
1. Drag BG bugs into the queue
2. For each bug, fill the form:
   - Obtained results (textarea)
   - Pass/Fail (checkbox)
   - FN QAA (checkbox) — to finalize the subtask on creation
   - Add to Epic (checkbox) — link QAA-172 ↔ BG
   - Change BG status (select with transitions, in REAL TIME on change)
3. Click "Enviar cola a QAA" → runs `sincronizarSubtareaQAA(issue, finalizar)` per bug

**Sync logic (idempotent)**:
- Looks up whether a QAA Task with label `bg-{bgkey}` already exists (JQL) or via issueLinks (fallback)
- If it EXISTS → PUT only the diff (summary, priority, labels, fixVersions, description), copies missing attachments, missing links, transition if applicable. Blue badge "↻ Actualizada"
- If it does NOT EXIST → POST creates it, green badge "✓ Creada"
- Retry without priority if the PUT returns 400 INVALID (because the edit screen does not accept it)

**Traceability**:
- IssueLink Relates QAA ↔ BG (always)
- IssueLink Relates QAA ↔ QAA-172 Epic (always — for `linkedIssues()` in JQL)
- IssueLink Relates QAA-172 ↔ BG (optional, if "Agregar al Epic")
- Append to the BG description with a "Subtarea QAA vinculada" section (idempotent — checks if already present)

### Tab "Bulk Epic"

**Purpose**: MASSIVELY generate the missing TCs of an Epic (those in the Epic's structure but NOT yet executed).

**UI**:
- Left column: list of QAA Epics with their "N missing" counter
- Right column: on selecting an Epic, shows the list of missing TCs + bulk form:
  - Result (Pass/Fail)
  - Priority (select: Medium / Highest / High / Low / Lowest)
  - Obtained results (textarea, one line = one item of the orderedList)
  - Images (multiple file input)
  - Checkbox `FN QAA` (transition to Finalizada)
  - Button "Generar N TCs"

**Filter (identical to the `missing-panel` in history.html)**:
- Only Epics with QA_STRUCTURE in their description appear
- Per Epic: crosses `estructura.testCases` with existing issues (`parent = epicKey AND fixVersion = versionActual`) using `extractTCTitle` (case-insensitive)
- The missing ones are the `testCases` whose title does NOT match any executed summary

**Generation logic** (per missing TC):
1. Build an ADF description identical to Qa_form (info panel → identification table → preconditions → data → steps → expected result → obtained result → postconditions)
2. POST `/issue` with parent=epic, customfield_10014=epic, labels (estado-X, type-X, moduloLabels, version), priority from the select, fixVersions
3. Upload images to each created issue
4. If FN QAA: transition to Finalizada with `_transicionarADone(key)`

**Output**:
- Banner with a summary: `12 generados + FN QAA en Sprint 23.`
- List of clickable links `TC-01 → QAA-200`, `TC-02 → QAA-201`, ...
- Individual per-TC errors below if any

**Implementation**: `bulk-epic.js` (~22 KB)

## 3. history.html (route `/history`)

**Purpose**: view the history of executed TCs, with filters by Epic + version.

**Key features**:
- List of QAA issues with summary, status, labels, date
- **missing-panel**: coverage calculation per Epic
  - Loads the selected Epic's structure
  - JQL `parent = epicKey [AND fixVersion = ...]`
  - Compares titles with `extractTCTitle()` → shows which ones were NOT executed
  - Click on a missing TC → redirects to `/?modulo=X&tc=Y` to run it
- **retest-panel**: failed TCs that require retest (label `retest` + `estado-fail`)

## 4. actividades.html (route `/actividades`)

Another view, probably a board. (Check the file if detail is needed.)

## 5. jira_editor.html (route `/jira-editor`)

Raw JSON editor for issues. Useful for debugging and repair.

## How the flows connect

```
New individual TC ──→ Qa_form.html ──→ Issue QAA
                                            │
                                            ↓
                                       (If Fail + bug)
                                            │
                                            ↓
                                          Bug BG
                                            │
                                            ↓
                              bg_verificacion.html (verifies)
                                            │
                                            ↓
                                       Subtarea QAA verificación
                                       (linked Relates)

Bulk generation ──→ bg_verificacion.html (Bulk Epic) ──→ N Issues QAA

View history ──→ history.html ──→ (discovers missing) ──→ Qa_form.html
                            ↓
                       (also Bulk Epic now)
```

## Auto-detection details

- **versionActual**: detected on load of bg_verificacion.html (top filter `test-v*` not released)
- **EpicFilter**: the list of epics is loaded from Jira when EpicFilter.init runs on each page that uses it
- **estructura del Epic**: cached in `_estructuraCache` by bulk-epic.js (parses the JSON between `QA_STRUCTURE_START/END`)
