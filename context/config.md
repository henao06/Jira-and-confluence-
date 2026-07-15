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

### Portones fail-soft → /connect y /setup (reemplaza el viejo 503)

`Server.JS` ya NO hace fail-fast con página 503. Hay **dos portones** separados,
en orden:

1. **Faltan secretos** (`JIRA_HOST`/`JIRA_EMAIL`/`JIRA_TOKEN`) → **302 → `/connect`**
   (el portón mínimo de conexión, ver "Capa 1" abajo).
2. **Falta / es inválido `qa-config.json`** → `getConfig()` devuelve un config
   neutro vacío (`resolveConfig({})`) con `setupRequired=true` → **302 → `/setup`**
   (el wizard de personalización). NO hay fallback por variables `.env`.
3. **Todo ok** → la app corre.

Solo se interceptan las **páginas de la app**. La **allowlist** que pasa SIEMPRE
(sin redirigir): assets estáticos (css/js), `/config.js`, `/setup`, `/setup/*`,
`/connect`, `/jira/*`, `/wiki/*`. Así los portones pueden cargar, testear la
conexión y guardar sin quedar atrapados en su propio redirect.

> `qa-config.json` es la **fuente única** de config estructural: si falta o es
> inválido, el wizard `/setup` es **forzado** (no hay fallback por `.env`). Las
> variables estructurales viejas del `.env` (`QA_PROJECT` etc.) quedaron obsoletas
> y ya **no se leen** — el `.env` solo guarda secretos de conexión.

## Variables de entorno

Tras eliminar el fallback legacy, el `.env` guarda **SOLO secretos de conexión**. La
config estructural (proyectos, campos, epics, workflow, confluence, branding) vive
**únicamente en `qa-config.json`** y se edita desde el wizard.

### Secretos (lo único que hoy lee el `.env`)

| Variable | Req/Opt | Descripción |
|----------|---------|-------------|
| `PORT` | Req | Puerto HTTP donde escucha Server.JS |
| `JIRA_HOST` | Req | Host de la instancia Jira Cloud (ej. `tu-empresa.atlassian.net`) |
| `JIRA_EMAIL` | Req | Email de la cuenta/bot de Jira para auth Basic |
| `JIRA_TOKEN` | Req | API token de Atlassian para auth Basic |

> Si faltan `JIRA_HOST`/`JIRA_EMAIL`/`JIRA_TOKEN` → redirect al portón `/connect`.

### Variables estructurales OBSOLETAS (ya NO se leen)

Estas variables las leía el viejo `resolveFromEnv()` (eliminado). Hoy el server **las
ignora**: su equivalente vive en `qa-config.json` (ver "Resolución al shape plano"). Se
listan solo como referencia histórica / mapeo:

| Variable obsoleta | Equivalente actual en `qa-config.json` |
|-------------------|----------------------------------------|
| `QA_PROJECT` / `BUG_PROJECT` / `TECH_PROJECT` | `boards.qa` / `.bug` / `.tech` (board activo) |
| `FIELD_REPORTER_EMAIL` / `FIELD_REPORTER_NAME` / `FIELD_CATEGORY` / `FIELD_EPIC_LINK` / `FIELD_BG_DEPENDENCY` | `fields.*` |
| `EPIC_VERIFICATION` / `EPIC_ACTIVITIES` | `epics.*` del board QA activo |
| `TRANSITION_FINALIZE` / `STATUS_BUG_UNDER_REVIEW` / `VERSION_PREFIX` | `workflow.*` |
| `CONFLUENCE_HISTORY_PAGE_ID` / `CONFLUENCE_SPACE` | `confluence.*` |
| `ORG_NAME` / `APP_NAME` | `branding.*` |

> Regla general (en `qa-config.json`): sección **opcional vacía = feature apagada**. Ej.
> sin `boards.bug` no se ofrece reportar/verificar bugs; sin `confluence` no se publica.

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

Mapeo **histórico** `.env` → `APP_CONFIG` (referencia del contrato original de la
neutralización). **Hoy, tras eliminar el fallback legacy, solo `JIRA_HOST` sale del
`.env`**; el resto de las rutas de `APP_CONFIG` las llena `resolveConfig()` desde
`qa-config.json` (ver la tabla de variables obsoletas y "Resolución al shape plano"):

| `.env` (columna histórica) | Ruta en `APP_CONFIG` |
|--------|----------------------|
| `JIRA_HOST` | `jira.host` (+ derivados `jira.baseUrl`, `jira.browseUrl`) — **sigue del `.env`** |
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
4. Si es requerida para arrancar, sumarla a la validación de config.
5. Documentarla en este archivo (tabla de variables + tabla de mapeo).

## Setup wizard + qa-config.json (Fase 1)

A partir de Fase 1 la app se configura desde una **UI en el browser** (wizard de
primer arranque) en vez de editar `.env` a mano. La config estructural vive en un
JSON, y los secretos siguen SOLO en `.env`.

### Precedencia de config (en `Server.JS`)

```
qa-config.json válido  →  se usa
qa-config.json falta/inválido  →  config neutro vacío (setupRequired=true) → wizard /setup
```

1. **`qa-config.json` válido** — **fuente ÚNICA** de la config estructural: se usa.
2. **Falta o es inválido** — `getConfig()` devuelve un config neutro vacío
   (`resolveConfig({})`) con `setupRequired=true` → el server **fuerza** el redirect a
   `/setup` (ver "Fail-soft → /setup").

> **NO hay fallback por variables `.env`.** El viejo `resolveFromEnv()` (y su
> `envBoardMeta()`) fueron **eliminados** de `Server.JS`. Un `.env` con `QA_PROJECT`
> etc. ya no alcanza para arrancar sin JSON: sin `qa-config.json` válido, el wizard es
> obligatorio.

### `qa-config.json` (nuevo archivo)

- **Gitignoreado**, generado por el wizard, **SIN secretos** (no guarda token ni creds).
- Contiene la config estructural. Shape:
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
    "branding":   { }
  }
  ```
- **Boards son arrays** (1 o N items, sin tope); `activeBoardId` elige el activo por
  tipo. Los **epics viven en el board QA activo**.

| Sección | Requerido/Opcional |
|---------|--------------------|
| `boards.qa` | **Requerido** — ≥1 item con `projectKey` |
| `boards.bug` / `boards.tech` | Opcional (vacío → feature apagada) |
| `fields` | Opcional |
| `workflow` | Opcional |
| `confluence` (con toggle `enabled`) | Opcional |
| `branding` | Opcional |

### Resolución al shape plano `APP_CONFIG`

`Server.JS` no cambió el contrato del front-end. `resolveConfig()` toma el **board
activo** de cada tipo (`activeBoardId`) y lo aplana al mismo `window.APP_CONFIG` de
siempre: `projects.qa/bug/tech`, `epics.*` del board QA activo, etc. Los ~70
consumidores del front NO cambiaron.

### Hot-reload

`GET /config.js` re-lee `qa-config.json` con **cache por `mtime`** (`getConfig()`).
Lo que guarda el wizard se refleja en el próximo reload de la página **sin reiniciar**
el server (única excepción: cambio de `PORT`, que sí requiere reinicio).

### Secretos (invariante)

- `JIRA_HOST` / `JIRA_EMAIL` / `JIRA_TOKEN` / `PORT` siguen **SOLO en `.env`**.
- **Invariante**: el token NUNCA está en `APP_CONFIG` ni en `qa-config.json`.
  `resolveConfig()` no lo copia y ningún endpoint de setup lo devuelve.
- El portón `/connect` (endpoint `POST /setup/secrets`) escribe el `.env`
  **server-side** (upsert preservando las líneas existentes) y hace rebuild de AUTH
  en memoria. Ver "Configuración en 3 capas → Capa 1".

### Endpoints nuevos (setup)

| Endpoint | Qué hace |
|----------|----------|
| `GET /setup` (ruta pretty → `setup.html`) | Sirve el wizard de personalización |
| `GET /connect` (→ `connect.html`) | Sirve el portón mínimo de conexión (solo secretos) |
| `GET /setup/status` | Reporta qué falta para completar la config |
| `POST /setup/secrets` | Guarda SOLO secretos: upsert `.env` (`JIRA_HOST/JIRA_EMAIL/JIRA_TOKEN/PORT`) + **rebuild de AUTH en memoria** (sin reiniciar). Nunca devuelve el token |
| `POST /setup/save` | Manda SOLO `{config}` (ya NO incluye secretos). Valida con `validateConfig` → escribe `qa-config.json`. **422** si inválido |
| `POST /setup/test-connection` | Prueba las creds tipeadas contra `/rest/api/3/myself` |
| `GET /setup/detect-fields` | Cataloga los custom fields vía `/rest/api/3/field` |

### Wizard `setup.html` (4 pasos — SIN conexión)

La conexión salió del wizard (vive en el portón `/connect`, ver Capa 1). El wizard
`/setup` quedó reducido a **personalización**:

1. **Tableros / Proyectos** (QA requerido; bug/tech opcionales; arrays de boards)
2. **Campos personalizados** (con detección automática de custom fields)
3. **Workflow + Confluence (toggle) + Branding + Textos de la interfaz (labels)**
4. **Revisar y guardar**

## Configuración en 3 capas (conexión / config / textos)

La config quedó separada en **tres capas** con responsabilidades distintas.

### Capa 1 — Secretos (conexión)

- Viven **SOLO en `.env`**: `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_TOKEN`, `PORT`.
- Se piden en el **portón `/connect`** (`connect.html`), una pantalla **mínima** que
  aparece SOLO al arrancar **si faltan secretos**.
- Endpoint **`POST /setup/secrets`** guarda **solo secretos**: upsert `.env` +
  **rebuild de AUTH en memoria**, **sin reiniciar** el server.
- **Invariante**: el token NUNCA se serializa a `/config.js` (`APP_CONFIG`).
- La **conexión NO es parte del wizard** de configuración — es un portón aparte.

### Capa 2 — Config estructural

- Vive en **`qa-config.json`** (gitignoreado): `boards` / `fields` / `workflow` /
  `confluence` / `branding` / `labels`.
- Se edita en el **wizard `/setup`** (`setup.html`), ahora de **4 pasos** (ver arriba).
- **`POST /setup/save`** manda **solo `{config}`** (ya NO incluye secretos) → valida
  y escribe `qa-config.json`.

### Capa 3 — Textos de interfaz configurables (labels) — NUEVO

- `Server.JS` define **`LABEL_DEFAULTS`** (defaults **genéricos**, sin valores de
  ninguna organización) y **`resolveLabels()`**, que los expone en
  **`window.APP_CONFIG.labels`**.
- El front usa el atributo **`data-label="clave"`** en el HTML + el script aplicador
  **`labels.js`**, que reemplaza el texto del elemento por el valor configurado.
  También expone **`window.Labels.get(clave, fallback)`** para textos generados por JS.
- **Claves actuales**: `reportBug`, `finalizeBug`, `finalizeTestCase`, `requiresConfig`.
- Cada instancia las **pisa** desde `qa-config.json` → `labels`.
- Ejemplo: el default de `finalizeTestCase` es **"Finalizar caso"** (genérico); una
  instancia (ej. Liceo) lo pisa a **"Finalizar TC"**.

Precedence de labels (igual espíritu que el resto de la config):

```
qa-config.json → labels  →  LABEL_DEFAULTS (genéricos)
```
