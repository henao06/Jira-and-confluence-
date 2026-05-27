# Arquitectura

## Server.JS (proxy + static server)

Servidor HTTP de Node.js puro (sin Express, sin dependencias). 600 líneas.

### Responsabilidades

1. **Servir archivos estáticos** del directorio raíz con MIME apropiados (.html, .js, .css, .png, .jpg, .ico)
2. **Proxy `/jira/*` → `https://liceopinoverde.atlassian.net/*`**:
   - Inyecta header `Authorization: Basic <base64(email:token)>`
   - Para POST/PUT a `/issue`: inyecta automáticamente `customfield_10271` (email) y `customfield_10337` (displayName) si no vienen
3. **Routing de paths bonitos** (sin extensión):
   - `/` → `Qa_form.html`
   - `/history` → `history.html`
   - `/jira-editor` → `jira_editor.html`
   - `/bg-verificacion` → `bg_verificacion.html`
   - `/actividades` → `actividades.html`
4. **CORS abierto** (`*`) para desarrollo
5. **Cache-Control: no-cache** para `.js` (importante: los cambios en JS se ven sin hard-refresh)

### Variables de entorno (al iniciar)

- `JIRA_EMAIL` — email del bot/usuario de Jira
- `JIRA_TOKEN` — API token de Atlassian
- `PORT` — puerto (default 3000?)

Si faltan, el server muestra error 503 con HTML explicativo.

### Inyección de custom fields (importante)

Lines 475-476 del Server.JS:
```js
if (!payload.fields.customfield_10271) payload.fields.customfield_10271 = JIRA_EMAIL;
if (!payload.fields.customfield_10337) payload.fields.customfield_10337 = myDisplayName || JIRA_EMAIL;
```

Estos NO los pone el cliente. Por eso si ves un POST y aparecen estos campos en el payload, es el server.

## Data flow general

```
Cliente (Browser)
  │
  │  fetch('/jira/rest/api/3/issue', { method: 'POST', body: {...} })
  ↓
Server.JS
  ├─ inyecta Authorization
  ├─ inyecta customfield_10271 / _10337
  └─ proxy → https://liceopinoverde.atlassian.net/rest/api/3/issue
                  ↓
              Atlassian Jira Cloud
                  ↓
              Response → Cliente
```

## Estructura de cada página HTML

Patrón típico (Qa_form.html, bg_verificacion.html, etc.):

```html
<head>
  <style>
    /* CSS inline — variables CSS en :root, layout, componentes */
  </style>
</head>
<body>
  <div class="page">
    <div class="hdr">…</div>  <!-- Header con nav buttons -->
    <main>…</main>            <!-- Contenido principal -->
  </div>

  <script src="/epic-filter.js"></script>     <!-- Módulos compartidos -->
  <script src="/bulk-epic.js"></script>       <!-- (sólo bg_verificacion) -->

  <script>
    /* JS inline grande — funciones del page */
    const JIRA_BASE = window.location.origin + '/jira';
    // ...
  </script>
</body>
```

## Módulos JS externos compartidos

| Archivo | Expone | Lo usa |
|---------|--------|--------|
| `epic-filter.js` | `EpicFilter.init`, `setEpics`, `loadEpicsFromJira`, `getJqlClause`, `getIgnoredEpics` | bg_verificacion, history, actividades |
| `bulk-epic.js` | `bulkState`, `cargarBulkEpics`, `renderBulkEpicList`, `seleccionarBulkEpic`, `completarBulk`, `setBulkResultado`, `setBulkFinalizar`, `setBulkPrioridad`, `agregarImagenesBulk`, `quitarImagenBulk` | bg_verificacion (tab Bulk) |
| `releases.js` | Funciones de releases/versions | history (probablemente) |
| `bg_reporter.js` | Helper para reportar bugs BG | Qa_form |

## Dependencias del JS externo

`bulk-epic.js` depende de globales que define el inline script de bg_verificacion.html:
- `JIRA_BASE`, `versionActual`
- `esc()`, `mkH()`, `mkP()`, `mkRule()`
- `_parseJiraError()`

Por eso bulk-epic.js no se puede usar standalone — necesita el host.

## Configuración del proyecto

No hay `package.json`. No hay `node_modules`. No hay build.

El server se corre con `node Server.JS` directamente. Sólo necesita Node 18+ (porque usa fetch nativo? hay que verificar).
