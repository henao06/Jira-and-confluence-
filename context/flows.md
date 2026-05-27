# Flujos de usuario

## 1. Qa_form.html (ruta `/`) — Ejecutar un TC manualmente

**Propósito**: el QA ejecuta UN test case y registra el resultado en Jira.

**Pasos**:
1. Seleccionar módulo (Epic) → se cargan los TCs configurados
2. Elegir TC del select → autocompleta precondiciones, pasos, esperado, etc.
3. Llenar resultado obtenido, marcar Pass/Fail/Blocked
4. Si Fail: severidad, frecuencia, impacto
5. Opcionales: adjuntos, requiere-config, reportar-bug, FN BG, FN QAA
6. Click "Enviar a Jira"

**Output**:
- 1 issue en QAA con descripción ADF completa
- (Si Fail + reportar-bug) 1 issue en BG vinculado vía issueLink
- (Si FN QAA) issue QAA transicionado a Finalizada (transition id 31)
- (Si FN BG) issue duplicado en BG, también Finalizada

**Edit mode**: si se navega con `?key=QAA-XX`, el form se llena con los datos del issue y submitea con PUT en vez de POST.

## 2. bg_verificacion.html (ruta `/bg-verificacion`)

Página con DOS tabs en el header (botones de la nav):

### Tab "Verificación BG" (default)

**Propósito**: el QA revisa bugs reportados en BG (status `Under Review`), los verifica, y crea/sincroniza una Tarea en QAA bajo el Epic `QAA-172`.

**UI**:
- Columna izquierda "Pendientes": bugs BG en estado Under Review, draggables
- Columna derecha "Cola QAA": bugs arrastrados acá, cada uno con form de verificación

**Pasos**:
1. Arrastrar bugs BG a la cola
2. Por cada bug, llenar el form:
   - Resultados obtenidos (textarea)
   - Pasa/Falla (checkbox)
   - FN QAA (checkbox) — para finalizar la subtarea al crear
   - Agregar al Epic (checkbox) — link QAA-172 ↔ BG
   - Cambiar estado del BG (select con transiciones, en TIEMPO REAL al cambiar)
3. Click "Enviar cola a QAA" → corre `sincronizarSubtareaQAA(issue, finalizar)` por cada bug

**Lógica de sync (idempotente)**:
- Busca si ya existe una Tarea QAA con label `bg-{bgkey}` (JQL) o por issueLinks (fallback)
- Si EXISTE → PUT solo del diff (summary, priority, labels, fixVersions, description), copia adjuntos faltantes, links faltantes, transición si corresponde. Badge azul "↻ Actualizada"
- Si NO EXISTE → POST crea, badge verde "✓ Creada"
- Retry sin priority si PUT da 400 INVALID (porque el screen de edit no lo acepta)

**Trazabilidad**:
- IssueLink Relates QAA ↔ BG (siempre)
- IssueLink Relates QAA ↔ QAA-172 Epic (siempre — para `linkedIssues()` en JQL)
- IssueLink Relates QAA-172 ↔ BG (opcional, si "Agregar al Epic")
- Append a la descripción del BG con sección "Subtarea QAA vinculada" (idempotente — chequea si ya está)

### Tab "Bulk Epic"

**Propósito**: generar MASIVAMENTE los TCs faltantes de un Epic (los que están en la estructura del Epic pero NO se han ejecutado todavía).

**UI**:
- Columna izquierda: lista de Epics QAA con su contador de "N faltantes"
- Columna derecha: al seleccionar un Epic, muestra la lista de TCs faltantes + form bulk:
  - Resultado (Pasa/Falla)
  - Prioridad (select: Medium / Highest / High / Low / Lowest)
  - Resultados obtenidos (textarea, una línea = un ítem del orderedList)
  - Imágenes (file input múltiple)
  - Checkbox `FN QAA` (transicionar a Finalizada)
  - Botón "Generar N TCs"

**Filtro (idéntico al `missing-panel` de history.html)**:
- Sólo aparecen Epics con QA_STRUCTURE en su descripción
- Por Epic: cruza `estructura.testCases` con issues existentes (`parent = epicKey AND fixVersion = versionActual`) usando `extractTCTitle` (case-insensitive)
- Los faltantes son los `testCases` cuyo título NO matchea ningún summary ejecutado

**Lógica de generación** (por cada TC missing):
1. Construir description ADF idéntica a Qa_form (panel info → tabla identificación → precondiciones → datos → pasos → resultado esperado → resultado obtenido → postcondiciones)
2. POST `/issue` con parent=epic, customfield_10014=epic, labels (estado-X, type-X, moduloLabels, version), priority del select, fixVersions
3. Subir imágenes a cada issue creado
4. Si FN QAA: transicionar a Finalizada con `_transicionarADone(key)`

**Output**:
- Banner con resumen: `12 generados + FN QAA en Sprint 23.`
- Lista de links clickeables `TC-01 → QAA-200`, `TC-02 → QAA-201`, ...
- Errores individuales por TC abajo si hubo

**Implementación**: `bulk-epic.js` (~22 KB)

## 3. history.html (ruta `/history`)

**Propósito**: ver el historial de TCs ejecutados, con filtros por Epic + version.

**Features clave**:
- Lista de issues QAA con summary, status, labels, fecha
- **missing-panel**: cálculo de cobertura por Epic
  - Carga estructura del Epic seleccionado
  - JQL `parent = epicKey [AND fixVersion = ...]`
  - Compara titulos con `extractTCTitle()` → muestra cuáles NO se ejecutaron
  - Click en un TC missing → redirige a `/?modulo=X&tc=Y` para ejecutarlo
- **retest-panel**: TCs fallados que requieren retest (label `retest` + `estado-fail`)

## 4. actividades.html (ruta `/actividades`)

Otra vista, probablemente tablero. (Revisar el archivo si se necesita detalle.)

## 5. jira_editor.html (ruta `/jira-editor`)

Editor JSON crudo de issues. Útil para debug y reparación.

## Cómo se conectan los flujos

```
TC nuevo individual ──→ Qa_form.html ──→ Issue QAA
                                            │
                                            ↓
                                       (Si Fail + bug)
                                            │
                                            ↓
                                          Bug BG
                                            │
                                            ↓
                              bg_verificacion.html (verifica)
                                            │
                                            ↓
                                       Subtarea QAA verificación
                                       (linked Relates)

Generación masiva ──→ bg_verificacion.html (Bulk Epic) ──→ N Issues QAA

Ver historia ──→ history.html ──→ (descubre missing) ──→ Qa_form.html
                            ↓
                       (también Bulk Epic ahora)
```

## Detalles de auto-detección

- **versionActual**: detectada al cargar bg_verificacion.html (top filter `test-v*` no released)
- **EpicFilter**: lista de epics se carga desde Jira al iniciar EpicFilter.init en cada page que lo usa
- **estructura del Epic**: cacheada en `_estructuraCache` por bulk-epic.js (parsea JSON entre `QA_STRUCTURE_START/END`)
