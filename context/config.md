# Configuración (config system)

> Cómo la app se volvió **org-neutral**: todo lo específico de una organización
> (dominio Jira, keys de proyecto, custom fields, epics, workflow, branding) sale
> de `.env` y llega al front-end como `window.APP_CONFIG`.
> Ver también: `architecture.md`, `jira.md`, `current-state.md` (entrada 2026-07-15).

## Flujo de configuración

```
.env  ──leído por──►  Server.JS (arma objeto CONFIG)
                          │
                          │  expone en GET /config.js  →  window.APP_CONFIG = {...}
                          ▼
                     Front-end (HTML + .js compartidos)
                          leen SIEMPRE desde APP_CONFIG (nada hardcodeado)
```

1. **`.env`** — fuente de verdad. No se commitea. Ver `.env.example` en la raíz del repo para el schema completo.
2. **`Server.JS`** — al iniciar lee `process.env` y construye un objeto `CONFIG` (agrupado por dominio: jira, projects, fields, epics, workflow, confluence, branding).
3. **`GET /config.js`** — el server sirve un script JS que asigna `window.APP_CONFIG = <CONFIG serializado>`. Es un endpoint dinámico, no un archivo estático.
4. **Front-end** — cada página carga `/config.js` como **primer `<script>` del `<head>`** (antes que cualquier otro JS), de modo que `window.APP_CONFIG` ya existe cuando corre el resto del código.

### Fail-fast (503 config-error)

`Server.JS` valida al arrancar. Si falta alguna de las variables **requeridas**
(`PORT`, `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_TOKEN`, `QA_PROJECT`), NO levanta la app:
sirve una página HTML de error 503 explicando qué falta. `QA_PROJECT` es el gate
que distingue "config incompleta" de "corriendo": sin proyecto QA la herramienta no
tiene nada que hacer.

## Variables de entorno

Leyenda: **Req** = requerida (sin ella → 503) · **Opt** = opcional (vacía = feature apagada).

| Variable | Req/Opt | Descripción |
|----------|---------|-------------|
| `PORT` | Req | Puerto HTTP donde escucha Server.JS |
| `JIRA_HOST` | Req | Host de la instancia Jira Cloud (ej. `tu-empresa.atlassian.net`) |
| `JIRA_EMAIL` | Req | Email de la cuenta/bot de Jira para auth Basic |
| `JIRA_TOKEN` | Req | API token de Atlassian para auth Basic |
| `QA_PROJECT` | Req | Key del proyecto de Test Cases (ej. `QAA`) — gate del fail-fast |
| `BUG_PROJECT` | Opt | Key del proyecto de Bugs (ej. `BG`). Vacío → flujo de bugs apagado |
| `TECH_PROJECT` | Opt | Key del proyecto Tech/TECH (ej. `SP`). Vacío → reporte TECH apagado |
| `FIELD_REPORTER_EMAIL` | Opt | ID del custom field de email del reporter (lo inyecta el server) |
| `FIELD_REPORTER_NAME` | Opt | ID del custom field de displayName del reporter (lo inyecta el server) |
| `FIELD_CATEGORY` | Opt | ID del custom field de categoría/clasificación |
| `FIELD_EPIC_LINK` | Opt | ID del custom field Epic Link (sistema viejo, compat) |
| `FIELD_BG_DEPENDENCY` | Opt | ID del custom field de dependencia con el proyecto de bugs |
| `EPIC_VERIFICATION` | Opt | Key del Epic que agrupa la verificación de bugs (ej. `QAA-172`) |
| `EPIC_ACTIVITIES` | Opt | Key del Epic que agrupa actividades/sugerencias (ej. `QAA-179`) |
| `TRANSITION_FINALIZE` | Opt | ID de la transición "Finalizar" del workflow QA (ej. `31`) |
| `STATUS_BUG_UNDER_REVIEW` | Opt | ID/nombre del estado "Under Review" del workflow de bugs |
| `VERSION_PREFIX` | Opt | Prefijo de las fixVersions del ciclo QA (ej. `test-v`) |
| `CONFLUENCE_HISTORY_PAGE_ID` | Opt | ID de la página de Confluence del historial de releases |
| `CONFLUENCE_SPACE` | Opt | Space key de Confluence donde vive la doc |
| `ORG_NAME` | Opt | Nombre de la organización (branding/UI) |
| `APP_NAME` | Opt | Nombre de la aplicación (branding/UI) |

> Regla general: variable **opcional vacía = feature apagada**. Ej. sin `BUG_PROJECT`
> no se ofrece reportar/verificar bugs; sin `CONFLUENCE_*` no se publica a Confluence.

## Shape de `window.APP_CONFIG` (el contrato)

Este es el objeto que consume el front-end. Agrupa las variables por dominio:

```js
window.APP_CONFIG = {
  jira:       { host, baseUrl, browseUrl },
  projects:   { qa, bug, tech },
  fields:     { reporterEmail, reporterName, category, epicLink, bgDependency },
  epics:      { verification, activities },
  workflow:   { finalizeTransitionId, bugUnderReviewStatusId, versionPrefix },
  confluence: { historyPageId, space },
  branding:   { orgName, appName }
}
```

Mapeo `.env` → `APP_CONFIG`:

| `.env` | Ruta en `APP_CONFIG` |
|--------|----------------------|
| `JIRA_HOST` | `jira.host` (+ derivados `jira.baseUrl`, `jira.browseUrl`) |
| `QA_PROJECT` / `BUG_PROJECT` / `TECH_PROJECT` | `projects.qa` / `.bug` / `.tech` |
| `FIELD_REPORTER_EMAIL` / `FIELD_REPORTER_NAME` | `fields.reporterEmail` / `.reporterName` |
| `FIELD_CATEGORY` / `FIELD_EPIC_LINK` / `FIELD_BG_DEPENDENCY` | `fields.category` / `.epicLink` / `.bgDependency` |
| `EPIC_VERIFICATION` / `EPIC_ACTIVITIES` | `epics.verification` / `.activities` |
| `TRANSITION_FINALIZE` / `STATUS_BUG_UNDER_REVIEW` / `VERSION_PREFIX` | `workflow.finalizeTransitionId` / `.bugUnderReviewStatusId` / `.versionPrefix` |
| `CONFLUENCE_HISTORY_PAGE_ID` / `CONFLUENCE_SPACE` | `confluence.historyPageId` / `.space` |
| `ORG_NAME` / `APP_NAME` | `branding.orgName` / `.appName` |

> Nota: `JIRA_EMAIL` y `JIRA_TOKEN` NO se exponen en `APP_CONFIG` (son secretos de
> auth server-side). El server los usa para el header `Authorization` del proxy.

## Cómo lo consume el front-end

- Cada HTML incluye, como **primer script del `<head>`**:
  ```html
  <script src="/config.js"></script>
  ```
  Esto garantiza que `window.APP_CONFIG` exista antes de correr cualquier lógica.
- El JS inline y los módulos compartidos leen de ahí, por ejemplo:
  ```js
  const JIRA_BASE = window.location.origin + '/jira';   // el proxy sigue igual
  const QA = window.APP_CONFIG.projects.qa;              // antes: 'QAA' hardcodeado
  const EPIC_VERIF = window.APP_CONFIG.epics.verification;
  ```
- **Nada de valores org-específicos hardcodeados** en HTML/JS: keys de proyecto,
  custom field IDs, keys de epic, transition IDs, prefijo de versión y branding
  vienen todos de `APP_CONFIG`.

## Para agregar una nueva variable de config

1. Agregarla a `.env` y documentarla en `.env.example`.
2. Mapearla en el objeto `CONFIG` de `Server.JS` (bajo el dominio que corresponda).
3. Consumirla en el front-end vía `window.APP_CONFIG.<dominio>.<clave>`.
4. Si es requerida para arrancar, sumarla a la validación fail-fast.
5. Documentarla en este archivo (tabla de variables + tabla de mapeo).
