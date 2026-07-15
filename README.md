# QA Tool — Suite de QA sobre Jira & Confluence

Plataforma autohospedada para equipos de QA que trabajan sobre Atlassian Jira (y,
opcionalmente, Confluence). Está escrita en Node.js plano, sin dependencias y sin paso de
build: se clona, se levanta con `node Server.JS` y se configura desde el navegador.

La premisa de diseño es simple y se respeta en todo el código: **la herramienta no sabe nada
de tu organización**. Ni el dominio, ni los proyectos, ni los custom fields, ni los nombres
están escritos en el código. Todo eso vive en dos archivos externos que se generan desde la
interfaz. Cualquiera puede clonar el repo, apuntarlo a su Jira y usarlo sin editar una línea.

## Por qué existe

Los formularios nativos de Jira son genéricos y lentos para un flujo de QA repetitivo: crear
un caso de prueba, adjuntar evidencia, reportar el bug asociado, vincularlo, transicionar
estados, versionar. Esta herramienta empaqueta ese flujo en pantallas hechas a medida y deja
que Jira siga siendo la fuente de verdad. No reemplaza a Jira: lo maneja por vos a través de
su API.

## Qué hace

- Crea casos de prueba como issues de Jira con contenido ADF (tablas, pasos, resultado
  esperado vs. obtenido), vinculados a un epic, con módulo, versión y adjuntos.
- Reporta bugs en el tablero de bugs y tareas en el tablero técnico, enlazados al caso de
  prueba de origen para mantener trazabilidad.
- Genera casos en lote leyendo la estructura `QA_STRUCTURE` declarada en la descripción de un
  epic, y detecta los que faltan.
- Muestra el historial completo, filtrable por epic, versión y estado, con edición inline.
- Verifica bugs en una cola de revisión y los transiciona por el workflow.
- Publica el historial de versiones en una página de Confluence (opcional).
- Permite tener varios tableros por tipo y cambiar el activo en vivo desde el encabezado.

## Cómo está armado

```
Navegador  ->  Server.JS (Node)  ->  API de Jira Cloud
                    |
                    |- inyecta la autenticación del lado servidor (el token nunca llega al browser)
                    |- sirve las páginas (HTML/JS sin framework)
                    |- publica tu configuración en /config.js  ->  window.APP_CONFIG
```

Hay tres capas separadas a propósito, y conviene tenerlas claras antes de tocar nada:

| Capa       | Qué contiene                                    | Dónde vive                         | Cómo se configura        |
|------------|-------------------------------------------------|------------------------------------|--------------------------|
| Conexión   | Dominio, email y token (secretos)               | `.env` (local, fuera de git)       | Pantalla `/connect`      |
| Proyecto   | Tableros, campos, epics, workflow, textos, tipos| `qa-config.json` (local, fuera de git) | Asistente `/setup`   |
| Aplicación | Las pantallas de QA                             | El código (neutro, igual para todos) | No se toca             |

La separación no es cosmética. Los secretos (el token) nunca se serializan al navegador ni se
mezclan con la configuración estructural. El servidor resuelve el tablero activo y expone
únicamente lo que el front necesita. Esa frontera es la que permite publicar el proyecto sin
filtrar credenciales.

## Puesta en marcha

```bash
git clone https://github.com/henao06/Jira-and-confluence-.git
cd Jira-and-confluence-

# No hay dependencias: no se corre npm install.
node Server.JS

# Abrir el navegador. Si falta la conexión, la app redirige sola a /connect.
# http://localhost:8080
```

El arranque no falla por configuración faltante. Si no encuentra el `.env`, levanta igual en
el puerto 8080 y te lleva a `/connect` para cargar las credenciales. Si ya hay credenciales
pero falta la configuración del proyecto, te lleva a `/setup`. Recién cuando ambas están
resueltas sirve la aplicación. En ningún caso hay que editar archivos a mano.

---

<details open>
<summary><h2>Configuración del proyecto (tableros, campos, textos)</h2></summary>

La configuración estructural vive en `qa-config.json`, en la raíz del repo. Está fuera de git
y no contiene secretos. Lo genera el asistente `/setup`; no hace falta escribirlo a mano, pero
vale la pena entender qué guarda porque es el archivo que define a qué se conecta la app.

### El asistente `/setup`

Son cuatro pasos:

1. **Tableros y proyectos.** Definís uno o varios tableros por tipo (QA, bugs, técnicos) y
   marcás cuál es el activo. El tablero de QA es obligatorio y necesita su project key; el
   resto es opcional.
2. **Campos personalizados.** Mapeás los `customfield_XXXXX` de tu instancia. Hay un botón que
   los detecta automáticamente consultando tu Jira, así no tenés que buscarlos a mano.
3. **Workflow, Confluence, marca, textos y tipos de issue.** Las transiciones de estado, la
   integración opcional con Confluence, el nombre de tu organización, los textos de la interfaz
   y los tipos de issue.
4. **Revisión y guardado.** Un resumen antes de confirmar.

Podés volver a `/setup` cuando quieras. Los cambios se aplican sin reiniciar el servidor: se
detecta la modificación del archivo y se recarga la configuración en caliente. La única
excepción es el puerto, que sí requiere reinicio.

### Ejemplo de `qa-config.json`

Los valores son de ejemplo y neutros; reemplazalos por los de tu instancia.

```jsonc
{
  "version": 1,

  // Tableros por tipo. Puede haber uno o varios por tipo; "activeBoardId" define el activo.
  "boards": {
    "qa": {                                  // obligatorio: al menos un tablero de QA
      "activeBoardId": "qa-web",
      "items": [
        {
          "id": "qa-web",                    // identificador interno que elegís vos
          "name": "QA Web",                  // nombre visible en el selector del encabezado
          "projectKey": "PROJ",              // project key en tu Jira
          "epics": {                         // epics donde se cuelgan los issues (opcional)
            "verification": "PROJ-100",
            "activities":   "PROJ-101"
          }
        }
      ]
    },
    "bug":  { "activeBoardId": "bugs", "items": [ { "id": "bugs", "name": "Bugs", "projectKey": "BUG", "epics": {} } ] },
    "tech": { "activeBoardId": "",     "items": [] }   // vacío: el tipo queda deshabilitado
  },

  // IDs de custom fields de tu instancia (el asistente los detecta). epicLink trae el default estándar.
  "fields": {
    "reporterEmail": "customfield_10001",
    "reporterName":  "customfield_10002",
    "category":      "customfield_10003",
    "epicLink":      "customfield_10014",   // default estándar de Jira Cloud
    "bgDependency":  "customfield_10004"
  },

  // IDs propios de tu workflow: la transición al finalizar, el estado "en revisión", etc.
  "workflow": {
    "finalizeTransitionId":   "31",
    "bugUnderReviewStatusId": "10261",
    "versionPrefix":          "v"           // prefijo de las versiones, por ejemplo v1.0
  },

  // Confluence es opcional. Con enabled en false no se publica nada.
  "confluence": {
    "enabled":       false,
    "historyPageId": "",
    "space":         ""
  },

  // Marca de tu organización; aparece en los títulos.
  "branding": {
    "orgName": "Acme Corp",
    "appName": "QA Suite"
  },

  // Textos de la interfaz. Si falta una clave, se usa el texto por defecto del código.
  "labels": {
    "reportBug":        "Reportar como bug",
    "finalizeBug":      "Finalizar bug",
    "finalizeTestCase": "Finalizar caso",
    "requiresConfig":   "Requiere configuración"
  },

  // Tipos de issue. Deben coincidir con los de tu Jira (por ejemplo "Task" si está en inglés).
  "issueTypes": {
    "testCase": "Tarea",
    "techTask": "Tech Task",
    "options":  ["Tarea", "Subtarea", "Historia", "Error"]
  }
}
```

### Qué es obligatorio y qué es opcional

| Clave                                                        | Obligatorio | Si falta o queda vacío                                        |
|-------------------------------------------------------------|-------------|--------------------------------------------------------------|
| `version`                                                   | Sí (vale 1) | La configuración se considera inválida y se abre el asistente |
| `boards.qa` con al menos un item y `projectKey`             | Sí          | El asistente lo exige; es la condición mínima para arrancar   |
| `boards.bug` / `boards.tech`                                | No          | El tipo correspondiente queda deshabilitado                   |
| `fields.*`                                                  | No (ver nota)| El campo no se envía; algunos flujos lo necesitan            |
| `workflow.finalizeTransitionId` / `bugUnderReviewStatusId`  | No (ver nota)| El botón de finalizar fallará: son IDs propios de tu Jira    |
| `confluence`                                                | No          | Con `enabled:false` no se publica nada                        |
| `branding`                                                  | No          | Defaults: `QA Suite` / `QA Automation`                        |
| `labels`                                                    | No          | Se usan los textos por defecto                                |
| `issueTypes`                                                | No          | Defaults: `Tarea`, `Tech Task`, `[Tarea, Subtarea, Historia, Error]` |

Nota importante sobre `fields.*` y `workflow.*`: son identificadores únicos de cada instancia
de Jira. La aplicación no los puede adivinar. Si los dejás vacíos o mal, esos features
concretos van a dar error contra la API. No rompen la aplicación, pero no funcionan hasta que
los cargues bien. Para eso está la detección automática de campos en el asistente.

### De dónde sacar cada valor

Esta es la parte que más cuesta la primera vez, así que vale detallarla. La mayoría de estos
valores se pueden averiguar sin salir de la herramienta: como el servidor hace de proxy
autenticado hacia Jira en `/jira/*`, podés abrir directamente los endpoints de la API en el
navegador (con la app corriendo) y ver el JSON, sin pelear con tokens ni curl. Reemplazá el
puerto por el tuyo.

- **Project key** (`boards.*.items[].projectKey`). Es el prefijo de los issues, lo ves en
  cualquier clave: en `PROJ-123`, el key es `PROJ`. También aparece en la URL del proyecto y en
  la lista de proyectos de Jira.

- **Custom fields** (`fields.reporterEmail`, `reporterName`, `category`, `bgDependency`). Son
  los `customfield_XXXXX`. Lo más cómodo es el botón "Detectar campos" del asistente. Si querés
  verlos crudos, abrí `http://localhost:8080/jira/rest/api/3/field`: devuelve todos los campos
  con su `id` y su `name`, buscás el tuyo por nombre y copiás el id. `epicLink` en Jira Cloud
  suele ser `customfield_10014` (el default que ya trae).

- **Epics** (`boards.*.items[].epics.verification` y `activities`). Son claves de issue de tipo
  Epic, por ejemplo `PROJ-100`. Las sacás del propio epic en Jira: es la clave que figura en su
  encabezado o en la URL.

- **Transición de finalizar** (`workflow.finalizeTransitionId`). Es el ID numérico de la
  transición que querés disparar al "finalizar". No es el nombre, es el ID. Para verlo, abrí
  `http://localhost:8080/jira/rest/api/3/issue/PROJ-1/transitions` (usando la clave de un issue
  real de ese proyecto y estado): lista las transiciones disponibles con su `id` y su `name`.
  Copiás el `id` de la que corresponda.

- **Estado "en revisión"** (`workflow.bugUnderReviewStatusId`). Es el ID numérico del estado en
  el que la pantalla de verificación busca los bugs. En
  `http://localhost:8080/jira/rest/api/3/status` tenés todos los estados con su `id` y su
  `name`; buscás el que uses para "under review" y copiás el `id`.

- **Prefijo de versión** (`workflow.versionPrefix`). No sale de Jira: es tu convención. Si tus
  versiones se llaman `v1.0`, `v1.1`, el prefijo es `v`.

- **Tipos de issue** (`issueTypes.testCase`, `techTask`, `options`). Son los nombres exactos de
  los tipos de tu instancia, tal como los escribe Jira (respetando idioma y mayúsculas). Los ves
  en `http://localhost:8080/jira/rest/api/3/issuetype`, o en la configuración de tipos de issue
  del proyecto. Si tu Jira está en inglés, seguramente sean `Task`, `Sub-task`, `Story`, `Bug`.

- **Confluence** (`confluence.historyPageId` y `space`). El `historyPageId` es el número que
  aparece en la URL de la página donde se publica el historial: en
  `.../wiki/spaces/QD/pages/78053377/...`, el id es `78053377`. El `space` es la clave del
  espacio, en ese mismo ejemplo `QD`.

### Personalizar los textos

Cualquier etiqueta de la interfaz que tenga una clave en `labels` se puede reemplazar. Los
valores por defecto son genéricos, no atados a ninguna organización. Si tu equipo usa otra
nomenclatura —por ejemplo "Finalizar QC" en lugar de "Finalizar caso"— alcanza con poner
`"finalizeTestCase": "Finalizar QC"`. No es un sistema de i18n completo: es un mecanismo de
override, pensado para cubrir el 20% de los textos que importan sin reescribir todo.

### Varios tableros

En `boards.*.items` podés cargar tantos tableros como necesites por tipo, y elegir el activo
con `activeBoardId`. El selector del encabezado permite cambiar el tablero activo en vivo; el
servidor vuelve a resolver la configuración con el tablero elegido y las pantallas no cambian.

### Los filtros de la pantalla de verificación

La pantalla `/bg-verificacion` no trae los filtros escritos en el código: los toma de la
descripción del epic de verificación. Esto es lo que hay que entender para usarla bien.

Al cargar, la pantalla arranca con un filtro por defecto que arma sola:

```
project = <tablero de bugs> AND status = <bugUnderReviewStatusId> ORDER BY priority DESC, created DESC
```

Es decir, muestra los bugs de tu tablero de bugs que están en el estado "en revisión" que
configuraste. Ese es el fallback y funciona sin tocar nada.

Pero además lee la descripción del epic (`epics.verification`) y busca ahí bloques de código
con consultas JQL. Cada bloque de JQL que encuentre, precedido por un encabezado, se convierte
en una opción del selector de filtros: el encabezado es el nombre que ves en el desplegable y
el bloque es la consulta que se ejecuta. Así el equipo define sus propias vistas de
verificación escribiéndolas en el epic, sin tocar la herramienta. Si mañana querés una vista
nueva ("bugs críticos de la última release", por ejemplo), agregás un encabezado y su bloque
JQL en la descripción del epic y aparece como filtro.

Un par de comportamientos que conviene saber:

- El proyecto destino de cada filtro se deduce leyendo el `project = XXX` de su propia JQL. Por
  eso un mismo selector puede alternar entre el tablero de bugs y el técnico según qué filtro
  elijas.
- Cuando el filtro activo apunta al tablero de bugs, se le suma la cláusula del filtro de epics
  del encabezado (el componente `epic-filter.js`), para poder acotar por epic sin reescribir la
  JQL.
- Los resultados se piden trayendo, entre otros campos, el de dependencia bug↔caso
  (`fields.bgDependency`), que es el que mantiene el vínculo entre el bug y el caso de prueba de
  origen.

En resumen: el estado por defecto sale de tu configuración, y las vistas adicionales son
datos que vos escribís en el epic. La herramienta solo las interpreta.

### Documentación técnica

Para arquitectura interna, flujos y convenciones de código, ver el directorio `context/`:
`README.md` (índice), `architecture.md`, `jira.md`, `flows.md`, `conventions.md`, `config.md`
y `current-state.md`.

</details>

---

<details>
<summary><h2>Configuración de la conexión con Jira (.env y token)</h2></summary>

Las credenciales de Jira son secretos y viven únicamente en el archivo `.env`, local y fuera
de git. No salen al navegador ni se comparten. Se cargan desde la pantalla `/connect`, que
aparece automáticamente al arrancar cuando faltan.

### Variables del `.env`

| Variable     | Qué es                                        | Ejemplo                    |
|--------------|-----------------------------------------------|----------------------------|
| `JIRA_HOST`  | Dominio de tu Jira Cloud, sin `https://`      | `tu-empresa.atlassian.net` |
| `JIRA_EMAIL` | Email de la cuenta                            | `vos@tu-empresa.com`       |
| `JIRA_TOKEN` | API token (secreto)                           | `ATATT3xFfGF0...`          |
| `PORT`       | Puerto del servidor (opcional)                | `8080` (por defecto)       |

El `.env` lo escribe la pantalla `/connect`. No hace falta crearlo a mano.

### Cómo obtener el API token

1. Entrar a id.atlassian.com, sección Security, API tokens
   (`https://id.atlassian.com/manage-profile/security/api-tokens`).
2. Crear un token, ponerle un nombre y copiarlo.
3. Pegarlo en el campo correspondiente de la pantalla `/connect`.

### La pantalla `/connect`

- El botón de probar conexión valida host, email y token contra Jira y devuelve tu nombre si
  todo está bien.
- El botón de guardar escribe el `.env` y entra a la aplicación.
- Podés dejar el token vacío para conservar el que ya estaba cargado; es útil cuando solo
  cambiás el dominio.

### Sobre la seguridad

- El token no se serializa nunca a `/config.js` ni llega al navegador: se queda en el servidor.
- `.env` y `qa-config.json` están en `.gitignore` y no se versionan.
- Todas las llamadas a Jira pasan por el proxy del servidor, que agrega la autenticación del
  lado del servidor. El cliente nunca manda el header de autorización.

### Cambiar la conexión más adelante

Volvé a `/connect` en cualquier momento. Si cambiás el puerto, hay que reiniciar el servidor;
la app lo avisa en pantalla.

</details>

---

## Pantallas y componentes

| Ruta o archivo                    | Qué hace                                                              |
|-----------------------------------|----------------------------------------------------------------------|
| `/` (`Qa_form.html`)              | Formulario de creación de casos de prueba y reporte de bugs          |
| `/history` (`history.html`)       | Historial filtrable, con edición inline y panel de casos faltantes   |
| `/actividades` (`actividades.html`)| Registro de actividades y tareas técnicas                           |
| `/bg-verificacion` (`bg_verificacion.html`) | Verificación de bugs en cola de revisión                   |
| `/jira-editor` (`jira_editor.html`)| Editor JSON del `QA_STRUCTURE` de los epics                         |
| `/setup` (`setup.html`)           | Asistente de configuración del proyecto                              |
| `/connect` (`connect.html`)       | Pantalla de conexión con Jira                                        |
| `bg_reporter.js`                  | Reporte de bugs y tareas técnicas vinculadas                        |
| `bulk-epic.js`                    | Generación de casos en lote a partir de `QA_STRUCTURE`              |
| `releases.js`                     | Gestión de versiones y publicación en Confluence                    |
| `epic-filter.js`, `board-switcher.js`, `labels.js` | Filtro de epics, selector de tablero y textos configurables |
| `mcp-confluence/`                 | Servidor MCP con operaciones de Confluence, en Python               |

## Stack y requisitos

- Node.js, cualquier versión LTS reciente. Sin dependencias de npm.
- HTML, CSS y JavaScript sin framework ni build.
- Una cuenta de Jira Cloud con un API token.
- Opcionalmente Python 3 para el servidor MCP de Confluence.

## Problemas frecuentes

- **Cambié algo y la app se ve igual.** Es caché del navegador. Forzá la recarga con
  Ctrl+Shift+R. Si tocaste `Server.JS`, además reiniciá el servidor.
- **El botón de finalizar da error.** Revisá `workflow.finalizeTransitionId` en `/setup`: es
  un ID propio de tu workflow de Jira.
- **No crea el issue o dice que el tipo es inválido.** Revisá `issueTypes` en `/setup`: los
  tipos deben existir en tu Jira (por ejemplo "Task" si tu instancia está en inglés).
- **Saqué el `qa-config.json` y me manda al asistente.** Es el comportamiento esperado. Ese
  archivo es la única fuente de la configuración del proyecto; sin él, la app pide configurarse.
