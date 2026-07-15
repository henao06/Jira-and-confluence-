# Confluence MCP Server

MCP (Model Context Protocol) server for **Atlassian Confluence Cloud**.
Exposes Confluence operations (pages, attachments, comments, labels,
whiteboards, spaces, users) as tools any MCP-compatible agent can call.

## Tools incluidas (25)

### Páginas
- `search_pages(query, space_key?, limit?)` — búsqueda CQL o texto
- `get_page(page_id, include_body?)` — fetch por ID
- `get_page_by_title(title, space_key)` — fetch por título exacto
- `create_page(space_key, title, body, parent_id?, body_format?)` — crear página
- `update_page(page_id, title?, body?, body_format?, minor_edit?)` — actualizar
- `append_to_page(page_id, html_to_append)` — anexar HTML al final
- `delete_page(page_id)` — soft delete
- `list_page_versions(page_id, limit?)` — historial
- `get_page_children(page_id, limit?)` — páginas hijas

### Espacios
- `list_spaces(limit?)` — todos los spaces visibles
- `get_space(space_key)` — detalle de un space
- `list_space_content(space_key, limit?)` — páginas del space
- `get_space_id_from_key(space_key)` — convertir key → ID numérico (para v2 API)

### Attachments
- `list_attachments(page_id, limit?)` — listar
- `upload_attachment(page_id, file_path, comment?)` — subir archivo local
- `delete_attachment(attachment_id)` — eliminar

### Comments
- `list_comments(page_id, limit?)` — listar comentarios
- `add_comment(page_id, body)` — postear comentario
- `delete_comment(comment_id)` — eliminar

### Labels
- `get_page_labels(page_id)` — labels actuales
- `add_page_labels(page_id, labels)` — agregar varios
- `remove_page_label(page_id, label)` — quitar uno

### Whiteboards (pizarras — v2 API)
- `list_whiteboards(space_id?, limit?)` — listar
- `get_whiteboard(whiteboard_id)` — fetch
- `create_whiteboard(space_id, title, parent_id?)` — crear nueva pizarra
- `delete_whiteboard(whiteboard_id)` — eliminar

### Users
- `get_current_user()` — datos del user autenticado
- `search_users(query, limit?)` — buscar usuarios

### CQL raw
- `cql_search(cql, limit?)` — query CQL arbitraria

---

## Instalación

```bash
cd /home/sebastian/QA/mcp-confluence
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

Esto instala `mcp`, `httpx`, `python-dotenv` y registra el comando `confluence-mcp`.

## Configuración

Copiá `env.example.txt` a `.env` y completalo:

```bash
cp env.example.txt .env
# editar .env con tu CONFLUENCE_TOKEN
```

Tu API token lo creás en https://id.atlassian.com/manage-profile/security/api-tokens (no es la contraseña).

## Probar manualmente

```bash
source .venv/bin/activate
confluence-mcp
# o:
python -m confluence_mcp.server
```

El server queda escuchando en stdio. Para probar las tools, usá el MCP inspector:

```bash
npx @modelcontextprotocol/inspector confluence-mcp
```

Abre una UI web donde podés ejecutar cada tool con argumentos arbitrarios.

## Conectar a Claude Desktop

Edita `~/.config/claude-desktop/claude_desktop_config.json` (Linux):

```json
{
  "mcpServers": {
    "confluence": {
      "command": "/ruta/a/mcp-confluence/.venv/bin/confluence-mcp",
      "env": {
        "CONFLUENCE_BASE_URL":   "https://tu-empresa.atlassian.net",
        "CONFLUENCE_EMAIL":      "tu-email@empresa.com",
        "CONFLUENCE_TOKEN":      "tu-api-token",
        "CONFLUENCE_DEFAULT_SPACE": ""
      }
    }
  }
}
```

Después reiniciás Claude Desktop y vas a ver las tools de Confluence disponibles.

## Conectar a Claude Code

```bash
claude mcp add confluence /ruta/a/mcp-confluence/.venv/bin/confluence-mcp \
  --env CONFLUENCE_BASE_URL=https://tu-empresa.atlassian.net \
  --env CONFLUENCE_EMAIL=tu-email \
  --env CONFLUENCE_TOKEN=tu-token
```

## Conectar a Cursor / Cline / etc

Mismo patrón: la config MCP de cada cliente pide `command` + `env`.
Pasale `/home/sebastian/QA/mcp-confluence/.venv/bin/confluence-mcp` y las 3 env vars.

---

## Detalles técnicos

- **Auth**: Basic con email + API token, exactamente como el `Server.JS` de este repo.
- **APIs**: usa v1 (`/wiki/rest/api`) para la mayoría de operaciones y v2 (`/wiki/api/v2`)
  para whiteboards (que solo existen en v2).
- **Errores**: cada tool devuelve `{ok: bool, data?, error?, status?}`. Si Jira responde 4xx/5xx,
  el campo `body` incluye la respuesta cruda para debug.
- **Body de páginas**: por default usa formato `storage` (XML estructurado de Confluence).
  Si querés escribir wiki markup pasá `body_format: "wiki"`.

## Limitaciones conocidas

- **Crear/modificar contenido DE una whiteboard** (formas, sticky notes, etc.) no es posible
  vía REST API pública de Confluence Cloud. La API solo permite crear/eliminar el contenedor
  whiteboard. El contenido interno se edita solo desde la UI.
- **Spaces creation**: requiere permisos de admin. No incluido.
- **Espacios "personal"** (`~username`): no se exponen como personalSpace de la API; se
  acceden con su space key normal.
