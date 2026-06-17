# Estado actual

> Última actualización: 2026-06-17

## En qué estamos trabajando

**Feature activa**: Tab "Bulk Epic" en `bg_verificacion.html` — generación masiva de TCs faltantes por Epic.

**Estado**: Funcional, probado parcialmente. Quedan pendientes algunos ajustes finos según uso real.

## Cambios recientes (orden cronológico inverso)

### 2026-06-17 — actividades.html: reporte dual BG + TECH (SP)
- Checkbox "🐛 Reportar como bug en BG" renombrado a "🐛 BG"; agregado nuevo checkbox "🛠️ TECH".
- TECH crea una **Tech Task** en el proyecto **SP** (LPV Tech, id 10303, cloudId d4aeb06d-33c0-40d9-b9c1-ed860026cfcf), vinculada al QAA con link `Relates`, mismo panel/descripción estilo reporte que BG.
- Se pueden marcar BG, TECH, ambos o ninguno. El `result-box` muestra los links según lo creado (QAA siempre · BG en rojo · Tech SP en azul).
- Panel de campos (Asignar a / Versión / Entorno) **compartido**: aparece si BG o TECH está marcado. `bg_reporter.js` ahora carga asignables vía `user/assignable/multiProjectSearch?projectKeys=...` (intersección de los proyectos activos).
- `bg_reporter.js`: lógica de creación generalizada en `_crearReporteIssue()`; `crearBugBG` (BG) y `crearTechSP` (SP) son envoltorios. `toggleBgAssignee()` ya no recibe `chk` (lee los checkboxes). Removido `bgUsersLoaded` → reemplazado por `_assigneeKey`.
- **Tipo de issue por tablero**: cada proyecto tiene su propio catálogo de issuetypes (QAA/BG: Tarea·Historia·Error; SP: Tarea·Tech Task·Feature·Error). Antes un único selector servía a QAA+BG (bug latente: funcionaba sólo porque comparten catálogo). Ahora hay un selector por tablero activo: `tipo-actividad` (QAA, siempre), `bg-tipo` (aparece con BG, default `Error`), `tech-tipo` (aparece con TECH, default `Tech Task`). `loadTiposActividad` se generalizó en `loadTiposProyecto(projectKey, selId, preferido)` que filtra nivel 0 no-subtarea de `/project/{key}`. `crearTechSP` ahora respeta `opts.tipo`.
- Archivos: `actividades.html`, `bg_reporter.js`.

### 2026-06-02 — MCP server INSTALADO y funcional (Python)
- `pip install -e .` ejecutado en `/home/sebastian/QA/mcp-confluence/.venv/`
- Dependencias instaladas: mcp 1.27.2, httpx 0.28.1, python-dotenv 1.2.2 + transitivos (pydantic, starlette, uvicorn, jsonschema, etc.)
- Comando `confluence-mcp` disponible en `.venv/bin/confluence-mcp`
- 29 tools verificadas (FastMCP las registró correctamente al importar el módulo)
- Falta para que funcione: crear `.env` con CONFLUENCE_TOKEN real (el usuario lo debe completar manualmente — el archivo .env está protegido por permisos de Claude)

### 2026-06-02 — MCP server de Confluence (Python, standalone)
- Nuevo directorio `/home/sebastian/QA/mcp-confluence/`
- Archivos:
  - `pyproject.toml` — dependencias (mcp, httpx, python-dotenv) + entry point `confluence-mcp`
  - `env.example.txt` — template de .env (renombrar a .env y completar token)
  - `confluence_mcp/__init__.py` — package init
  - `confluence_mcp/client.py` — HTTP client con Basic auth, soporta v1 (/wiki/rest/api) y v2 (/wiki/api/v2)
  - `confluence_mcp/server.py` — MCP server con 25+ tools (FastMCP)
  - `README.md` — instalación, config para Claude Desktop / Claude Code / Cursor / Cline
- Tools incluidas:
  - **Pages** (9): search_pages, get_page, get_page_by_title, create_page, update_page, append_to_page, delete_page, list_page_versions, get_page_children
  - **Spaces** (4): list_spaces, get_space, list_space_content, get_space_id_from_key
  - **Attachments** (3): list_attachments, upload_attachment, delete_attachment
  - **Comments** (3): list_comments, add_comment, delete_comment
  - **Labels** (3): get_page_labels, add_page_labels, remove_page_label
  - **Whiteboards** (4): list_whiteboards, get_whiteboard, create_whiteboard, delete_whiteboard (v2 API)
  - **Users** (2): get_current_user, search_users
  - **CQL** (1): cql_search (raw CQL)
- Limitaciones documentadas: contenido INTERNO de whiteboards (formas, sticky notes) no editable vía REST pública — solo se crea/elimina el contenedor

### 2026-06-01 — history.html: editar issuetype inline
- Agregada capacidad de cambiar el tipo de tarea (issuetype) directamente desde la tabla del historial
- Cambios:
  - `issuetype` agregado al fetch de fields en los 3 lugares de JQL (search principal + paginaciones)
  - En cada fila Issue cell: pill compacto con el nombre del issuetype (Tarea/Subtarea/Historia/Error/Epic) + botón `↕` debajo del key
  - Nueva función `openIssuetypePicker(event, key)` con 4 opciones (Tarea, Historia, Error, Subtarea) — patrón clonado de `openEstadoPicker`
  - Nueva función `applyIssuetypeChange(key, name)` que hace PUT `/issue/{key}` con `fields: { issuetype: { name } }`
  - Manejo de error con alert si Jira rechaza (ej. cambiar a Subtarea sin parent válido)
- CSS nuevo: `.p-it-tarea`, `.p-it-subtarea`, `.p-it-historia`, `.p-it-error`, `.p-it-epic` con paleta del proyecto

### 2026-05-28 — Defaults de motivo/sesión que van a Confluence (parche)
- Encontré 3 strings en español que NO había traducido en la primera pasada porque eran VALORES por defecto (no labels):
  - `iniciarSesion(motivo = 'Nueva sesión')` → `'New session'` — usado si el flow llama sin argumento
  - `iniciarSesion(motivo.trim() || 'Nueva sesión')` → `'New session'` — fallback del prompt
  - `ejecutarPublicacion`: `'Sin motivo'` → `'No reason provided'` (motivo) y `'Nueva sesión'` → `'New session'` (motivoSig)
- Estos defaults se propagan a la página de Confluence cuando el usuario no escribe nada en el modal
- Ahora el reporte sale 100% en inglés salvo lo que el usuario tipea (motivo/observaciones) y los summaries originales de los issues (data Jira)

### 2026-05-28 — Confluence content traducido a inglés
- Todo el texto que `releases.js` genera para Confluence quedó en inglés
- Mantuve en español: nombres de funciones internas, comentarios de código, modal de publicación local (UI app)
- Cambios principales:
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
- IMPORTANTE: Cambiar el `title` en el PUT a Confluence **renombra** la página existente (la próxima publicación). Si querés mantener el title viejo por compat, hay que revertir solo esa línea.

### 2026-05-27 — onTestCaseChange: auto-fill completo + reset residual
- En `Qa_form.html` función `onTestCaseChange()`:
  - Agregado bloque de RESET al inicio que limpia todo lo residual del TC anterior:
    - estado / severidad / frecuencia (vars + botones .e-btn/.sev-btn)
    - row-severity, row-frecuencia (visibility)
    - checkboxes: reportar-bug, requiere-config, registrarEnBG, registrarEnQAAFinalizada
    - bg-assignee-wrap (visibility)
    - uploadedFiles + configFiles (con re-render)
    - obtenido-wrap, soluc-wrap, sugg-wrap (rebuild a una fila vacía)
  - Agregado `setVal('url-pantalla', tc.urlPantalla)` que faltaba — ya está documentado en el schema (jira_editor.html)
- Preserva: módulo, tester, fecha, versión (cosas globales que no cambian entre TCs)
- Trigger: al seleccionar otro TC del select, no quedan rastros del anterior

### 2026-05-27 — Auditoría schema QA_STRUCTURE + fix doc
- Verificación: cada campo del ejemplo en jira_editor.html (schema hint) SÍ se usa en el código
- Encontrado UN campo usado pero no documentado: `tc.urlPantalla` (lo lee bulk-epic.js:_buildTCDescription → row "URL / Pantalla")
- Fix: agregado a jira_editor.html schema hint con comentario "opcional → URL clickeable en la tabla de identificación"
- Resto del schema confirmado correcto

### 2026-05-26 — Resumen Confluence: links + quitar columnas duplicadas
- En `agregarAlHistorialConfluence`:
  - Removida la columna **Version** del cuadro métrica (ya está en el título de la macro y en la 1ra línea del body)
  - Removida la columna **Fecha** (idem, ya está en el body)
  - Tabla ahora arranca directamente con Total | Pass | Fail | Blocked | Retest | Actividades | Vinculados | Tasa
  - Body del resumen agregada línea "Versión: <link>test-v003</link>" — link a la release page del proyecto QAA
  - "BG Bugs reportados: N" → el N ahora es link clickeable a JQL `key in (...)` con todos los bugs reportados
- URLs nuevas:
  - releasesUrl: `${JIRA_UI}/projects/QAA?selectedItem=com.atlassian.jira.jira-projects-plugin%3Arelease-page&status=no-filter`
  - bgBugsJqlUrl: usa `key in (BG-XX,...)` con los bgIssues.key list

### 2026-05-26 — Fix paginación en obtenerDatosVersion (releases.js)
- BUG: el modal de publicar versión mostraba Total=100, pero el filtro de history mostraba 118
- ROOT CAUSE: el código usaba `startAt += 100` y `d.total` para paginar. La nueva API `/search/jql` de Jira Cloud:
  - **Ignora `startAt`** (siempre devuelve la primera página)
  - **No devuelve `total`** (es `undefined`)
- Como `d.total = undefined`, `allIssues.length >= 0` era siempre true → salía del loop después de la primera página con 100 issues
- FIX: cambiar a `nextPageToken` + `isLast` (igual que history.html). Es el mecanismo correcto de la API nueva.
- Validado: test-v003 ahora devuelve 118 issues (100 + 18 en segunda página)
- Impacta: Total / Pass / Fail / Blocked / Retest / Tasa / Actividades / Vinculados — todas las métricas del reporte Confluence

### 2026-05-26 — Columna "Vinculados" en cuadro Confluence
- Nueva columna entre Actividades y Tasa en la tabla métrica del reporte
- En `obtenerDatosVersion`: nuevo bloque que hace 2 fetches
  - GET QAA-172?fields=issuelinks → extrae BG keys enlazados al Epic
  - JQL `key in (linked) AND labels = "{version}"` → cruza por label de versión
  - Resultado: `stats.vinculados` (count) + `stats.vinculadosKeys` (array)
- En `agregarAlHistorialConfluence`: columna nueva con color morado (#7c3aed) y link a JQL `key in (...)` para abrir esos BGs en Jira UI
- Sin emojis (a pedido)
- Validado: test-v003 → 9 vinculados (los 10 del Epic, menos BG-117 que es de versión anterior)

### 2026-05-26 — Filtro Enlazadas + Version combinados (history.html)
- Investigación previa (vía curl): 9 de 10 BGs enlazados al Epic ya tenían label `test-v003`, BG-117 tenía `test-v002` (de versión anterior). 25 BGs totales con label test-v003 en general.
- Mod en `buildJQL`: cuando `f-enlazadas` está activo Y hay versión en `f-version`, suma al JQL `AND labels = "{version}"`. Así combina enlazadas-al-Epic con versión sin pelearse con `project=QAA` (que sigue desactivado).
- Validado vía curl:
  - Solo enlazadas → 10
  - Enlazadas + test-v003 → 9
  - Enlazadas + test-v002 → 1 (BG-117)

### 2026-05-26 — bg_verificacion: agregar label de versión al BG
- DESCUBRIMIENTO: el proyecto BG no tiene versiones definidas (versions son por-proyecto en Jira, no globales). Por eso los BGs no quedaban "asociados" a la versión del QA cycle.
- Decisión: en vez de `fixVersions` (requeriría admin para crear la versión en BG project), usamos un LABEL en el BG con el mismo nombre que `versionActual` (ej. "test-v003")
- En `sincronizarSubtareaQAA`: tras crear/actualizar QAA y la descripción del BG, ahora también:
  - Lee `labels` del BG (nueva field en el fetch existente)
  - Si `versionActual` no está como label, agrega un label nuevo y PUTea
- Idempotente: skip si el label ya está
- Beneficio: permite filtrar BGs por versión en history.html (vía `labels = "test-v003"`) y agruparlos en reportes Confluence

### 2026-05-26 — buildJQL: short-circuit cuando f-enlazadas activo
- v6 traía las 10 keys BG bien, pero buildJQL las combinaba con otros filtros QAA-específicos (fixVersion=test-vN, project=QAA) que filtraban los BGs fuera
- Fix: cuando `f-enlazadas` está activo, buildJQL **short-circuita** y devuelve SOLO `key in (...) ORDER BY created DESC`, ignorando todos los otros filtros
- Si el usuario quiere combinar con otros filtros, debe desactivar este checkbox (trade-off documentado en el código)
- Validado: 10 BGs visibles en la tabla con summaries reales

### 2026-05-26 — fetchEnlazadasKeys: v6 = simple, devuelve TODAS las linked
- El usuario quería filtrar TODAS las Actividades vinculadas (incluyendo BG-, no solo QAA-)
- Saqué el two-hop: vuelve a 1 sola request
- `fetchEnlazadasKeys` ahora devuelve todas las keys del field `issuelinks` de QAA-172 (sin filtrar prefijo) excepto QAA-172 mismo
- `buildJQL` ajustado: cuando `f-enlazadas` está activo, saca el `project = QAA` del base. El `key in (...)` ya limita el universo
- Validado vía curl: 10 keys (todas BG- en este Jira)

### 2026-05-26 — fetchEnlazadasKeys: v5 con two-hop (DESCARTADA)
- Iteraciones del checkbox `#f-enlazadas` en `history.html`:
  - v1: walk de TODOS los BG paginados (lento)
  - v2: JQL `linkedIssues("QAA-172", "relates to")` — devolvía 0
  - v3: `GET /issue/QAA-172?fields=issuelinks` filtrando QAA — devolvía 0
  - v4: igual que v3 sin filtro de tipo — seguía 0
  - **v5 (actual)**: two-hop lookup
- DESCUBRIMIENTO clave (vía curl directo al server proxy): QAA-172 NO tiene links a QAAs. Solo a BGs (10 BGs, vienen del checkbox "Agregar al Epic")
- El link Relates QAA-task ↔ QAA-172 que mencionaba el comentario de bg_verificacion.html EN LA PRÁCTICA NO se crea (o se borró). El POST puede estar fallando silenciosamente
- v5 hace:
  - Hop 1: GET /issue/QAA-172?fields=issuelinks → extrae BG keys
  - Hop 2: Promise.all() de GETs a cada BG → extrae QAA keys de sus issuelinks
- 1 + N requests pero todo paralelo. Total ~1-2s
- Validado: 10 BGs → 7 QAAs únicas (verificado vía `node` + curl)

### 2026-05-26 — Columna "Actividades" en cuadro Confluence
- En `releases.js` (`obtenerDatosVersion`): agregado `actividadIssues = allIssues.filter(i => i.fields.parent?.key === 'QAA-179')` y `stats.actividades`
- En `agregarAlHistorialConfluence`: nueva columna "Actividades" entre Retest y Tasa, con count clickeable que linkea a JQL `parent = QAA-179` filtrado por versión
- Color azul (#0369a1) para distinguir de las otras métricas
- Las actividades ya aparecían en `total` y en `byModule` (bajo QAA-179), pero invisible en el resumen de métricas — ahora se ven

### 2026-05-26 — Crear estructura `context/` y `CLAUDE.md`
- Establecida la documentación maestra del proyecto en `/home/sebastian/QA/context/`
- Creado `/home/sebastian/QA/CLAUDE.md` como entry point automático para Claude
- Obligación: leer context/ al inicio de cada sesión, actualizar tras cambios significativos

### 2026-05-26 — Links clickeables en descripción ADF de bulk
- En `bulk-epic.js`, la tabla "Identificación del Test Case" ahora linkea:
  - Módulo → Epic en Jira (browse)
  - Versión → página de releases QAA
  - Historia → autodetect: si es Jira key → browse, si es URL → URL, sino texto plano
  - URL / Pantalla → si es URL, link
- Helpers nuevos en bulk-epic.js: `_esJiraKey`, `_esUrl`, `_mkLinkText`, `_mkTableCellLink`, `_mkTableRowLink`, `_mkTableRowSmart`
- Constantes: `_JIRA_BROWSE`, `_JIRA_VERSIONS`

### 2026-05-26 — Quitar panel "Resultado" del ADF bulk
- En `_buildTCDescription` de `bulk-epic.js`, removido el panel con heading "Resultado" + "Estado: Pass" + tc.impacto
- Razón: el usuario no quería ver "Los usuarios no pueden..." en la descripción (era del `impacto` del structure JSON)
- El estado pasa/falla queda reflejado solo en los **labels** del issue

### 2026-05-26 — Banner con links de issues creados
- Tras bulk creation, el banner ahora muestra cada issue creado como link: `TC-01 → QAA-200`
- Errores individuales debajo si hubo
- Cambio de `textContent` a `innerHTML` (todo escapeado con `esc()`)

### 2026-05-26 — Fix priority 400 + select de Prioridad
- `tc.prioridad` del structure JSON podía traer cualquier valor → Jira rechazaba
- Solución: agregar SELECT de Prioridad en el form bulk (Medium / Highest / High / Low / Lowest), igual que Qa_form
- `bulkState.prioridad` reemplaza el uso de `tc.prioridad` en el POST
- Removido el helper `_normalizarPriority` (innecesario con el select)

### 2026-05-26 — Botón "Finalizar en QAA" → checkbox FN QAA
- Reemplazado el botón morado "Finalizar en QAA" por un checkbox con clase `checkbox-label`
- Funciona como el `registrarEnQAAFinalizada` de Qa_form: al marcar + Generar, transiciona cada TC creado a Finalizada
- `bulkState.finalizar` (boolean) controla el comportamiento

### 2026-05-26 — Reescribir bulk para filtrar como `missing-panel`
- Cambio fundamental: el bulk ahora no muestra "tareas QAA no-Done", sino **TCs definidos en `estructura.testCases` que NO tienen issue todavía**
- Mismo algoritmo que `missing-panel` en history.html
- Construye descripción ADF idéntica a Qa_form (panel info → tabla → precondiciones → datos → pasos → esperado → obtenido → postcondiciones)
- POST a `/issue` con parent=epic, customfield_10014=epic, labels, fixVersion, etc.

### 2026-05-26 — Extraer bulk a `bulk-epic.js`
- Movida toda la lógica del modo bulk de bg_verificacion.html a un archivo separado
- Incluido vía `<script src="/bulk-epic.js"></script>` en el head
- Depende de globales del host (JIRA_BASE, esc, mk*, etc.)

### 2026-05-26 — Tab system → botones en header
- En vez de barra de tabs separada, los dos modos son botones en `.hdr-right`: "Verificación" y "Bulk Epic"
- Estilo `btn-hdr-history` + `btn-hdr-tab.active` con gradient verde
- `cambiarTab(name)` usa selector `[data-tab]` (universal)

### 2026-05-26 — Comprobador idempotente en sincronizarSubtareaQAA
- Cambio mayor en bg_verificacion.html: `crearSubtareaEnQAA` → `sincronizarSubtareaQAA`
- Busca subtarea existente por label `bg-{key}` (JQL) o issueLinks (fallback)
- Si existe: PUT solo del diff (description, priority, labels, fixVersions, summary)
- Adjuntos: diff por filename, copia los faltantes
- Links: chequea con `_existeLink` antes de crear
- Description BG: chequea con `_adfContieneKey(adf, qaaKey)` antes de append
- Retry sin priority si PUT da 400 (porque screen de edit no acepta priority)
- Badge azul `↻ Actualizada` vs verde `✓ Creada`

### Anterior — Real-time BG state changes
- Select `BG:` en cada card de la cola ahora hace POST a `/transitions` en tiempo real al cambiar
- Flag `item.bgTransitionAplicada` evita doble transición en submit
- Label muestra estado actual: `BG (Under Review):` → al cambiar → `BG (Done) ✓`

### Anterior — Unificar GET en addToQueue
- Antes: 2 fetches (transitions + issuelinks)
- Ahora: 1 fetch con `?fields=status,issuelinks&expand=transitions`
- Trae también el estado actual del BG para mostrarlo en el label

### Anterior — Badge-key clickeable
- Los `<span class="badge-key">` (BG-123, QAA-XX) ahora son `<a>` con link a Jira
- `target="_blank"` + `rel="noopener noreferrer"` + `event.stopPropagation()` (para drag)

## Bugs conocidos / TODOs

- [ ] **Idempotencia parcial en bulk**: el `_buildTCDescription` siempre crea desde cero. Si se vuelve a generar el mismo TC (forzando con label match), se duplica el issue. Mitigado porque el filtro `missing` ya skipea TCs con issue existente — pero si la versión cambia, podría duplicar.
- [ ] **Severidad/Frecuencia en Bulk**: no se aplica si es "Falla". El flow de bulk pierde esa info que sí tiene Qa_form.
- [ ] **BG bug auto-crear en Falla bulk**: el bulk no crea BG bugs cuando es Fail (a diferencia de Qa_form con checkbox "reportar-bug"). Si se necesita, agregar.
- [ ] **User link en "Tester"**: actualmente "QA Bulk" texto plano. Si se obtiene accountId, podría linkear a `/jira/people/{accountId}`.

## Archivos modificados en esta sesión

- `bg_verificacion.html` — múltiples (real-time, idempotencia, badge-key links, tab header, CSS tabs, CSS checkbox-label)
- `bulk-epic.js` — creado y reescrito varias veces (filtro missing, ADF builder, priority select, FN QAA checkbox, banner con links, ADF links)
- `CLAUDE.md` — creado
- `context/` — creado completo

## Cosas a no olvidar para la próxima sesión

1. **Hard refresh** después de tocar JS — el server pone `Cache-Control: no-cache` pero por las dudas
2. **versionActual** se auto-detecta solo en bg_verificacion.html — si se rompe, ahí está la lógica
3. **Los customfields 10271 y 10337** los inyecta Server.JS, NO mandarlos desde el cliente
4. **Priority en PUT** suele fallar — retry sin priority es el patrón
5. **ADF orderedList vacía** rechazada por Jira — siempre con al menos un item

## Para actualizar este archivo

Tras cualquier cambio significativo:
1. Agregar nueva entrada al inicio de "Cambios recientes" con fecha
2. Mover items completados de TODO a "Cambios recientes"
3. Sumar bugs nuevos a "Bugs conocidos / TODOs" si los hay
4. Actualizar el header "Última actualización" con la fecha de hoy
