# QA Tool — Suite de QA sobre Jira & Confluence

> Plataforma autohospedada de gestión de QA que integra con las APIs de **Jira** y **Confluence Cloud**.
> Node.js puro (**cero dependencias**), sin build: crear casos de prueba, reportar bugs, gestionar
> actividades y publicar releases, **directamente sobre tu Jira**, desde una interfaz simple.
>
> **Org-neutral**: la bajás, la configurás desde el navegador, y funciona con tu instancia —
> **sin tocar una sola línea de código**.

---

## ¿Qué es y para qué sirve?

Es un servidor liviano que actúa como **proxy y UI sobre la API de Jira Cloud**. En vez de pelear
con los formularios de Jira, tu equipo de QA usa pantallas hechas a medida para su flujo:

- **Crear casos de prueba** (test cases) como issues de Jira con contenido ADF enriquecido,
  vinculados a epics, con módulos, versión y adjuntos.
- **Reportar bugs** en el tablero de bugs y **tareas técnicas** en el tablero técnico, vinculados
  automáticamente al caso de prueba de origen (trazabilidad completa).
- **Generar casos en lote** leyendo la estructura `QA_STRUCTURE` de la descripción de un Epic.
- **Ver el historial** de todo lo creado, filtrable por epic/versión/estado, con edición inline.
- **Verificar bugs** (cola de "under review") y transicionarlos por el workflow.
- **Publicar el historial de versiones** a una página de Confluence (opcional).
- **Cambiar de tablero activo** en vivo desde el header (soporta N tableros por tipo).

## ¿Cómo funciona? (en 30 segundos)

```
Navegador  ──►  Server.JS (Node)  ──►  API de Jira Cloud
                     │
                     ├── inyecta la autenticación (tu token queda en el server, nunca en el browser)
                     ├── sirve las páginas de QA (HTML/JS vanilla)
                     └── expone tu configuración vía /config.js  →  window.APP_CONFIG
```

Hay **tres capas** bien separadas, y esto es clave:

| Capa | Qué guarda | Dónde vive | Cómo se configura |
|------|-----------|-----------|-------------------|
| 🔌 **Conexión** | Dominio, email, **token** (secreto) | `.env` (local, gitignoreado) | Pantalla `/connect` al arrancar |
| 📦 **Proyecto** | Tableros, campos, epics, workflow, textos, tipos | `qa-config.json` (gitignoreado) | Wizard `/setup` |
| 🖥️ **App** | Las páginas de QA | El código (neutro, igual para todos) | No se toca |

> **Principio de diseño:** en el código **NO hay NADA de una organización específica**.
> Todo lo tuyo (tableros, campos, dominio, nombres) sale de esos dos archivos externos.
> El que baja el proyecto configura lo suyo y listo.

---

## 🚀 Inicio rápido

```bash
# 1. Cloná el repo
git clone https://github.com/henao06/Jira-and-confluence-.git
cd Jira-and-confluence-

# 2. Arrancá el servidor (NO necesita npm install — cero dependencias)
node Server.JS

# 3. Abrí el navegador. Si falta la conexión, te lleva solo a /connect:
#    http://localhost:8080

# 4. Seguí el flujo EN PANTALLA (nada de editar archivos a mano):
#    /connect  → poné dominio + email + token  → genera el .env
#    /setup    → configurá tableros, campos, etc. → genera qa-config.json
#    /         → ¡a trabajar!
```

La app **nunca rompe por falta de configuración**: si falta algo, te lleva a la pantalla
que corresponde. Arranca incluso sin `.env` (en el puerto 8080 por defecto) para poder
mostrarte la pantalla de conexión.

---

<details open>
<summary><h2>📦 Configuración del PROYECTO (tableros, campos, textos…)</h2></summary>

Toda la config estructural vive en **`qa-config.json`** (en la raíz, gitignoreado, **sin secretos**).
Se genera y edita desde el **wizard `/setup`** — no hace falta escribirlo a mano, pero conviene
entender qué guarda cada parte.

### El wizard `/setup` (4 pasos)

1. **Tableros / Proyectos** — definís uno o varios tableros por tipo (QA, Bugs, Técnicos).
   Marcás cuál es el **activo**. El QA es obligatorio (con su `projectKey`); los demás son opcionales.
2. **Campos personalizados** — mapeás los `customfield_XXXXX` de tu Jira (hay botón **"Detectar campos"**
   que los trae de tu instancia).
3. **Workflow + Confluence + Branding + Textos + Tipos de issue** — transiciones, integración
   opcional de Confluence, nombre de tu org, textos de la interfaz y tipos de issue.
4. **Revisar y guardar** — resumen y confirmación.

> 💡 Podés volver a `/setup` cuando quieras para editar. Los cambios se aplican **sin reiniciar**
> el servidor (se recargan solos). Solo cambiar el **puerto** requiere reinicio.

### Ejemplo de `qa-config.json`

Valores de ejemplo (neutros) — reemplazá por los tuyos:

```jsonc
{
  "version": 1,

  // Tableros por tipo. Podés tener 1 o N por tipo; "activeBoardId" elige el activo.
  "boards": {
    "qa": {                                  // ← obligatorio: al menos 1 tablero QA
      "activeBoardId": "qa-web",
      "items": [
        {
          "id": "qa-web",                    // id único que vos elegís
          "name": "QA Web",                  // nombre visible en el selector del header
          "projectKey": "PROJ",              // project key en TU Jira
          "epics": {                         // epics donde se cuelgan los issues (opcional)
            "verification": "PROJ-100",
            "activities":   "PROJ-101"
          }
        }
      ]
    },
    "bug":  { "activeBoardId": "bugs", "items": [ { "id": "bugs", "name": "Bugs", "projectKey": "BUG", "epics": {} } ] },
    "tech": { "activeBoardId": "",     "items": [] }   // vacío = feature apagada
  },

  // IDs de custom fields de TU instancia (el wizard los detecta). epicLink trae default estándar.
  "fields": {
    "reporterEmail": "customfield_10001",
    "reporterName":  "customfield_10002",
    "category":      "customfield_10003",
    "epicLink":      "customfield_10014",   // default estándar de Jira Cloud
    "bgDependency":  "customfield_10004"
  },

  // IDs específicos de TU workflow (transición al finalizar, estado "en revisión", etc.)
  "workflow": {
    "finalizeTransitionId":   "31",
    "bugUnderReviewStatusId": "10261",
    "versionPrefix":          "v"           // prefijo de las versiones (ej. v1.0)
  },

  // Confluence es OPCIONAL: enabled:false = no se usa.
  "confluence": {
    "enabled":       false,
    "historyPageId": "",
    "space":         ""
  },

  // Marca de tu organización (aparece en títulos).
  "branding": {
    "orgName": "Acme Corp",
    "appName": "QA Suite"
  },

  // Textos de la interfaz. Vacío/ausente = usa los defaults genéricos del código.
  "labels": {
    "reportBug":        "Reportar como bug",
    "finalizeBug":      "Finalizar bug",
    "finalizeTestCase": "Finalizar caso",
    "requiresConfig":   "Requiere configuración"
  },

  // Tipos de issue: deben coincidir con TU Jira (ej. "Task" si está en inglés).
  "issueTypes": {
    "testCase": "Tarea",
    "techTask": "Tech Task",
    "options":  ["Tarea", "Subtarea", "Historia", "Error"]
  }
}
```

### Qué es obligatorio y qué es opcional

| Clave | ¿Obligatorio? | Si falta / vacío |
|-------|---------------|------------------|
| `version` | ✅ (debe ser `1`) | El config se considera inválido → wizard |
| `boards.qa` con ≥1 item + `projectKey` | ✅ | Wizard te lo pide (es el "gate") |
| `boards.bug` / `boards.tech` | ⬜ opcional | El feature de bugs/técnicos queda apagado |
| `fields.*` | ⬜ opcional* | El campo no se envía (algunos flujos lo necesitan) |
| `workflow.finalizeTransitionId` / `bugUnderReviewStatusId` | ⬜ opcional* | El botón "Finalizar" fallará: son **IDs propios de tu Jira** |
| `confluence` | ⬜ opcional | `enabled:false` → no se publica nada |
| `branding` | ⬜ opcional | Defaults: `QA Suite` / `QA Automation` |
| `labels` | ⬜ opcional | Defaults genéricos ("Reportar como bug", etc.) |
| `issueTypes` | ⬜ opcional | Defaults: `Tarea` / `Tech Task` / `[Tarea, Subtarea, Historia, Error]` |

> ⚠️ *(*) **Importante**: `fields.*` y `workflow.*` son **IDs únicos de cada instancia de Jira**.
> La app no los adivina: tenés que ponerlos bien (el wizard los detecta) o esos features
> específicos darán error. No rompe la app, pero el feature no anda hasta configurarlo.

### Personalizar los textos (sin i18n completo)

Cualquier etiqueta con su clave en `labels` se puede pisar. Los defaults son **genéricos**
(no atados a ninguna org). Ejemplo: si tu equipo dice "Finalizar QC" en vez de "Finalizar caso",
ponés `"finalizeTestCase": "Finalizar QC"` y listo.

### Múltiples tableros

Podés cargar N tableros por tipo en `boards.*.items` y elegir el **activo** con `activeBoardId`.
El selector del header permite cambiar el tablero activo en vivo, y el server re-resuelve toda
la config al tablero elegido — las páginas no cambian.

### Documentación técnica más profunda

Para arquitectura, flujos y convenciones internas, ver el directorio `context/`:
`README.md` (índice), `architecture.md`, `jira.md`, `flows.md`, `conventions.md`,
`config.md`, `current-state.md`.

</details>

---

<details>
<summary><h2>🔌 Configuración de CONEXIÓN con Jira (.env, token)</h2></summary>

La conexión con Jira son **secretos** y viven **solo** en el archivo `.env` (local, gitignoreado).
**Nunca** salen al navegador ni se comparten. Se configuran en la pantalla **`/connect`**, que
aparece automáticamente al arrancar si faltan credenciales.

### Variables del `.env`

| Variable | Qué es | Ejemplo |
|----------|--------|---------|
| `JIRA_HOST` | Dominio de tu Jira Cloud (sin `https://`) | `tu-empresa.atlassian.net` |
| `JIRA_EMAIL` | Email de la cuenta | `vos@tu-empresa.com` |
| `JIRA_TOKEN` | API token (secreto) | `ATATT3xFfGF0...` |
| `PORT` | Puerto del servidor (opcional) | `8080` (default) |

> El `.env` lo **genera la pantalla `/connect`** — no hace falta crearlo a mano.

### Cómo obtener el API Token

1. Entrá a **[id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)**.
2. **"Create API token"**, ponele un nombre, copialo.
3. Pegalo en la pantalla `/connect` (campo "API Token").

### La pantalla `/connect`

- **"Probar conexión"** → valida host + email + token contra Jira y te muestra tu nombre si anda (✓ verde).
- **"Guardar y arrancar"** → escribe el `.env` y entra a la app (con animación de carga).
- Podés dejar el token vacío para **conservar** el que ya tenías (útil al cambiar solo el dominio).

### Seguridad

- El **token nunca** se serializa a `/config.js` ni llega al navegador — se queda en el server.
- El `.env` y el `qa-config.json` están en `.gitignore`: **no se suben al repo**.
- Todos los llamados a Jira pasan por el proxy del server, que inyecta la auth del lado servidor.

### Cambiar la conexión después

Volvé a `http://localhost:PUERTO/connect` en cualquier momento. Si cambiás el **puerto**,
hay que reiniciar el servidor (la app te avisa).

</details>

---

## 🗺️ Páginas y componentes

| Ruta / archivo | Qué hace |
|----------------|----------|
| `/` (`Qa_form.html`) | Formulario de creación de casos de prueba (y reporte de bugs) |
| `/history` (`history.html`) | Historial filtrable, con edición inline y panel de casos faltantes por epic |
| `/actividades` (`actividades.html`) | Crear actividades / tareas técnicas |
| `/bg-verificacion` (`bg_verificacion.html`) | Verificación de bugs (cola "under review") |
| `/jira-editor` (`jira_editor.html`) | Editor JSON del `QA_STRUCTURE` de los epics |
| `/setup` (`setup.html`) | Wizard de configuración del proyecto |
| `/connect` (`connect.html`) | Pantalla de conexión con Jira |
| `bg_reporter.js` | Reporte de bugs y tareas técnicas vinculadas |
| `bulk-epic.js` | Generador de casos en lote desde `QA_STRUCTURE` |
| `releases.js` | Gestión de versiones y publicación a Confluence |
| `epic-filter.js` / `board-switcher.js` / `labels.js` | Componentes: filtro de epics, selector de tablero, textos configurables |
| `mcp-confluence/` | Servidor MCP con 25+ operaciones de Confluence (Python) para Claude Desktop/Code/Cursor |

## 🧱 Stack y requisitos

- **Node.js** (cualquier LTS reciente). **Cero dependencias npm** — no hace falta `npm install`.
- **HTML / JS / CSS vanilla**, sin build, sin framework.
- Una cuenta de **Jira Cloud** con un API token.
- (Opcional) **Python 3** + `mcp` SDK + `httpx` solo para el servidor MCP de Confluence.

## ❓ Problemas comunes

- **"Cambié algo pero la app se ve igual"** → es caché del navegador. Hacé **hard-refresh**
  (`Ctrl+Shift+R`). Si tocaste `Server.JS`, además **reiniciá el servidor**.
- **"El botón Finalizar da error"** → revisá `workflow.finalizeTransitionId` en `/setup`:
  es un ID propio de tu workflow de Jira.
- **"No crea el issue / tipo inválido"** → revisá `issueTypes` en `/setup`: deben coincidir
  con los tipos de TU Jira (ej. "Task" si está en inglés).
- **"Saqué el qa-config.json y me manda al wizard"** → es correcto: el JSON es la **fuente única**
  de la config del proyecto. Sin él, la app pide configurarse.

---

## Licencia

MIT

_Proyecto org-neutral: dominio, tableros, campos, epics y branding salen de `.env` + `qa-config.json`.
En el código no hay valores de ninguna organización._
