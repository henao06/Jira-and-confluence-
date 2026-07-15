# QA Suite — Test Cases, Bugs y Releases sobre Jira

Aplicación web liviana para gestionar el ciclo de QA directamente sobre **Jira Cloud**:
ejecutar y documentar test cases, verificar bugs, seguir cobertura e historial, y publicar
reportes de release en Confluence. Todo desde el navegador, sin frameworks ni build.

> **100% configurable.** No hay ningún identificador de organización hardcodeado en el código.
> Apuntás el `.env` a **tu** instancia de Jira, con **tus** proyectos y campos, y funciona.

---

## Requisitos

- **Node.js** 18+ (sin dependencias externas — solo la librería estándar)
- Una cuenta de **Jira Cloud** con un **API token**
  (generalo en https://id.atlassian.com/manage-profile/security/api-tokens)

## Puesta en marcha (5 minutos)

```bash
# 1. Copiá la plantilla de configuración
cp .env.example .env

# 2. Editá .env con los datos de tu instancia (ver tabla abajo)
#    Mínimo obligatorio: JIRA_HOST, JIRA_EMAIL, JIRA_TOKEN, PORT, QA_PROJECT

# 3. Levantá el servidor
node Server.JS

# 4. Abrí el navegador
#    http://localhost:8080   (o el PORT que hayas puesto)
```

Si falta alguna variable obligatoria, el servidor muestra una página de error clara
indicando exactamente cuál — no arranca a medias.

## Configuración

Toda la configuración vive en `.env` (gitignoreado, nunca se sube). El servidor la lee y la
expone al front-end como `window.APP_CONFIG` vía `/config.js`. Detalle completo de cada
variable en **[`context/config.md`](context/config.md)** y en `.env.example`.

| Grupo        | Variables | Obligatorio |
|--------------|-----------|-------------|
| Conexión     | `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_TOKEN`, `PORT` | Sí |
| Proyecto QA  | `QA_PROJECT` | Sí |
| Proyectos    | `BUG_PROJECT`, `TECH_PROJECT` | Opcional (según features) |
| Custom fields| `FIELD_EPIC_LINK`, `FIELD_REPORTER_EMAIL`, `FIELD_REPORTER_NAME`, `FIELD_CATEGORY`, `FIELD_BG_DEPENDENCY` | Opcional (vacío = feature off) |
| Epics padre  | `EPIC_VERIFICATION`, `EPIC_ACTIVITIES` | Opcional |
| Workflow     | `TRANSITION_FINALIZE`, `STATUS_BUG_UNDER_REVIEW`, `VERSION_PREFIX` | Opcional |
| Confluence   | `CONFLUENCE_HISTORY_PAGE_ID`, `CONFLUENCE_SPACE` | Opcional |
| Branding     | `ORG_NAME`, `APP_NAME` | Opcional |

> **¿No sabés el ID de un custom field?** Con el server corriendo, entrá a
> `http://localhost:PORT/debug/campos-qaa` o consultá `{JIRA_HOST}/rest/api/3/field`.

## Pantallas

| Ruta               | Pantalla | Qué hace |
|--------------------|----------|----------|
| `/`                | Test Case | Ejecutar y documentar un test case → crea el issue en Jira |
| `/bg-verificacion` | Verificación de bugs | Verificar bugs y generar sus subtareas de QA; generación masiva por Epic |
| `/history`         | Historial | Historial de test cases, cobertura y panel de retest |
| `/actividades`     | Actividades | Tablero de actividades + reporte dual de bug / tarea técnica |
| `/jira-editor`     | Editor | Editor JSON crudo de la estructura QA de un Epic |

## Cómo funciona (arquitectura)

`Server.JS` es un servidor Node puro que hace tres cosas:

1. **Sirve los archivos estáticos** (HTML/JS/CSS) y las rutas amigables de arriba.
2. **Proxy autenticado** a Jira (`/jira/*`) y Confluence (`/wiki/*`): inyecta la auth
   (`Basic email:token`) del lado del server, así el token **nunca** viaja al navegador.
3. **Expone la config** (`/config.js` → `window.APP_CONFIG`) para que el front no tenga
   ningún valor de instancia hardcodeado.

Todos los llamados del cliente van por `window.location.origin + '/jira'`. Detalle técnico
en **[`context/architecture.md`](context/architecture.md)** y **[`context/jira.md`](context/jira.md)**.

## Seguridad

- El API token y todo dato sensible viven solo en `.env` (gitignoreado). Nunca en el código.
- La autenticación se inyecta en el proxy del servidor; el navegador nunca ve las credenciales.
- Antes de publicar el repo, revisá que tu `.env` real no esté trackeado: `git status`.

## Extras

- **`mcp-confluence/`** — servidor MCP (Python) para operar Confluence desde clientes MCP.
- **`responsive-proxy/`** — herramienta de desarrollo para probar la app en tablets de la LAN.
