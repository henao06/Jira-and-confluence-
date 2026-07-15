# Context · QA Tool Project

Self-managed context folder. Read in this order to understand the project.

## Index

| File | Contents | When to read |
|---------|-----------|-------------|
| [README.md](README.md) | This overview | Always first |
| [architecture.md](architecture.md) | Server.JS, files, data flow | Any code task |
| [config.md](config.md) | Config system: `.env` → `APP_CONFIG` | Before touching org-specific values |
| [jira.md](jira.md) | Projects, custom fields, endpoints, ADF | Any task that touches Jira |
| [flows.md](flows.md) | User flows per page | To understand what each screen does |
| [conventions.md](conventions.md) | Code patterns + ADF helpers | Before writing code |
| [current-state.md](current-state.md) | Current state + recent changes + TODO | Always at the start of a session |

## 60-second overview

**What it is**: An application to manage the execution of Test Cases in Jira (Atlassian Cloud). It is **org-neutral**: the Jira domain, project keys, custom fields, epics and branding are configured via `.env` → `window.APP_CONFIG` (see [config.md](config.md)). Values like QAA/BG shown below are **examples** from a real instance, not fixed values.

**What it is for**:
- Run test cases manually (Qa_form.html) → creates an issue in Jira (QA project, e.g. QAA)
- Verify reported bugs (bg_verificacion.html) → generates QAA subtasks with bidirectional traceability
- Generate missing TCs in bulk by Epic (bulk-epic in bg_verificacion.html)
- View history, coverage, releases (history.html, actividades.html)

**Stack**: Vanilla HTML + JS + inline CSS. No frameworks. No build step. Server.JS is a Node.js proxy with no external dependencies to the Jira REST API v3.

**Key convention**: EVERY call to Jira goes through `window.location.origin + '/jira'` (the server rewrites it to Atlassian + adds auth + adds email/displayName custom fields).

## Files in the repo (root)

```
Server.JS                  ← HTTP proxy to Jira + serve static assets
Qa_form.html               ← TC execution form (the main screen)
bg_verificacion.html       ← Bug verification BG → QAA (with Bulk Epic tab)
bulk-epic.js               ← Bulk creation logic by Epic
history.html               ← History of executed TCs
actividades.html           ← Activities board
jira_editor.html           ← JSON issue editor
epic-filter.js             ← Persistent epic filter (shared across pages)
releases.js                ← Version/release management
bg_reporter.js             ← Helper to report BG bugs
styles.css                 ← Shared styles
README.md                  ← Human documentation
QA_GUIDE.md                ← Usage guide
IMPLEMENTATION(1).md       ← Historical implementation doc
context/                   ← THIS directory (Claude reads here)
CLAUDE.md                  ← Entry point for Claude
chatkit_uploads/           ← Uploaded files (do not touch)
```

## Rules for maintaining this directory

1. **After any significant change**, update `current-state.md` with a new entry under "Recent changes"
2. **If the Jira integration is touched** (new custom field, different endpoint), update `jira.md`
3. **If a screen/flow is added**, add it to `flows.md`
4. **If a new convention emerges**, add it to `conventions.md`
5. **Keep this README as a pure index** — do not embed detail here, link to the files
