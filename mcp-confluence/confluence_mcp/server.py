"""MCP server for Confluence Cloud — 29 tools."""
from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

from confluence_mcp.client import ConfluenceClient, ConfluenceError

load_dotenv()

app = FastMCP("confluence")
_client: ConfluenceClient | None = None


def client() -> ConfluenceClient:
    global _client
    if _client is None:
        _client = ConfluenceClient()
    return _client


def _ok(payload: Any) -> dict[str, Any]:
    return {"ok": True, "data": payload}


def _err(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, ConfluenceError):
        return {"ok": False, "status": exc.status, "error": str(exc), "body": exc.body}
    return {"ok": False, "error": str(exc)}


# ── PAGES ──────────────────────────────────────────────────────────────────
@app.tool()
def search_pages(query: str, space_key: str | None = None, limit: int = 25) -> dict:
    """Search Confluence pages using CQL or simple text."""
    try:
        c = client()
        is_cql = any(tok in query for tok in (" AND ", " OR ", "=", "~"))
        cql = query if is_cql else f'type = page AND text ~ "{query}"'
        if space_key and not is_cql:
            cql = f'space = {space_key} AND ' + cql
        params = {"cql": cql, "limit": min(limit, 100)}
        data = c.get(c.v1("/content/search"), params=params)
        return _ok([
            {
                "id":     r.get("id"),
                "title":  r.get("title"),
                "type":   r.get("type"),
                "space":  r.get("space", {}).get("key"),
                "status": r.get("status"),
                "url":    c.base_url + "/wiki" + r.get("_links", {}).get("webui", ""),
            }
            for r in (data.get("results") or [])
        ])
    except Exception as e:
        return _err(e)


@app.tool()
def get_page(page_id: str, include_body: bool = True) -> dict:
    """Fetch a Confluence page by ID."""
    try:
        c = client()
        expand = "version,space,ancestors"
        if include_body:
            expand += ",body.storage"
        data = c.get(c.v1(f"/content/{page_id}"), params={"expand": expand})
        return _ok({
            "id":      data.get("id"),
            "title":   data.get("title"),
            "type":    data.get("type"),
            "status":  data.get("status"),
            "space":   data.get("space", {}).get("key"),
            "version": data.get("version", {}).get("number"),
            "ancestors": [a.get("id") for a in data.get("ancestors") or []],
            "body":    (data.get("body") or {}).get("storage", {}).get("value") if include_body else None,
            "url":     c.base_url + "/wiki" + data.get("_links", {}).get("webui", ""),
        })
    except Exception as e:
        return _err(e)


@app.tool()
def get_page_by_title(title: str, space_key: str) -> dict:
    """Find a page by exact title within a space."""
    try:
        c = client()
        data = c.get(c.v1("/content"), params={
            "title": title, "spaceKey": space_key, "expand": "version,space",
        })
        results = data.get("results") or []
        if not results:
            return {"ok": False, "error": f'No se encontró página "{title}" en space {space_key}'}
        r = results[0]
        return _ok({
            "id":      r.get("id"),
            "title":   r.get("title"),
            "space":   r.get("space", {}).get("key"),
            "version": r.get("version", {}).get("number"),
            "url":     c.base_url + "/wiki" + r.get("_links", {}).get("webui", ""),
        })
    except Exception as e:
        return _err(e)


@app.tool()
def create_page(
    space_key: str,
    title: str,
    body: str,
    parent_id: str | None = None,
    body_format: str = "storage",
) -> dict:
    """Create a new Confluence page. body_format: 'storage' (XML) or 'wiki'."""
    try:
        c = client()
        payload: dict[str, Any] = {
            "type": "page",
            "title": title,
            "space": {"key": space_key},
            "body": {body_format: {"value": body, "representation": body_format}},
        }
        if parent_id:
            payload["ancestors"] = [{"id": parent_id}]
        data = c.post(c.v1("/content"), json=payload)
        return _ok({
            "id":    data.get("id"),
            "title": data.get("title"),
            "url":   c.base_url + "/wiki" + data.get("_links", {}).get("webui", ""),
        })
    except Exception as e:
        return _err(e)


@app.tool()
def update_page(
    page_id: str,
    title: str | None = None,
    body: str | None = None,
    body_format: str = "storage",
    minor_edit: bool = False,
) -> dict:
    """Update an existing page (keeps current values if not specified)."""
    try:
        c = client()
        current = c.get(c.v1(f"/content/{page_id}"), params={"expand": "version,space,body.storage"})
        new_version = (current.get("version", {}).get("number") or 0) + 1
        payload = {
            "id": page_id,
            "type": current.get("type", "page"),
            "title": title or current.get("title"),
            "space": {"key": current.get("space", {}).get("key")},
            "version": {"number": new_version, "minorEdit": minor_edit},
            "body": {
                body_format: {
                    "value": body if body is not None else (current.get("body") or {}).get("storage", {}).get("value", ""),
                    "representation": body_format,
                }
            },
        }
        data = c.put(c.v1(f"/content/{page_id}"), json=payload)
        return _ok({
            "id":      data.get("id"),
            "title":   data.get("title"),
            "version": data.get("version", {}).get("number"),
            "url":     c.base_url + "/wiki" + data.get("_links", {}).get("webui", ""),
        })
    except Exception as e:
        return _err(e)


@app.tool()
def append_to_page(page_id: str, html_to_append: str) -> dict:
    """Append HTML/storage content to the END of a page (preserves existing content)."""
    try:
        c = client()
        current = c.get(c.v1(f"/content/{page_id}"), params={"expand": "version,space,body.storage"})
        existing = (current.get("body") or {}).get("storage", {}).get("value", "") or ""
        new_version = (current.get("version", {}).get("number") or 0) + 1
        payload = {
            "id": page_id,
            "type": current.get("type", "page"),
            "title": current.get("title"),
            "space": {"key": current.get("space", {}).get("key")},
            "version": {"number": new_version},
            "body": {"storage": {"value": existing + html_to_append, "representation": "storage"}},
        }
        data = c.put(c.v1(f"/content/{page_id}"), json=payload)
        return _ok({"id": data.get("id"), "version": data.get("version", {}).get("number")})
    except Exception as e:
        return _err(e)


@app.tool()
def delete_page(page_id: str) -> dict:
    """Move a page to trash (soft delete)."""
    try:
        client().delete(client().v1(f"/content/{page_id}"))
        return _ok({"deleted": page_id})
    except Exception as e:
        return _err(e)


@app.tool()
def list_page_versions(page_id: str, limit: int = 50) -> dict:
    """List historical versions of a page."""
    try:
        c = client()
        data = c.get(c.v1(f"/content/{page_id}/version"), params={"limit": limit})
        return _ok([
            {
                "number":    v.get("number"),
                "when":      v.get("when"),
                "by":        (v.get("by") or {}).get("displayName"),
                "message":   v.get("message"),
                "minorEdit": v.get("minorEdit"),
            }
            for v in (data.get("results") or [])
        ])
    except Exception as e:
        return _err(e)


@app.tool()
def get_page_children(page_id: str, limit: int = 50) -> dict:
    """List child pages of a given page."""
    try:
        c = client()
        data = c.get(c.v1(f"/content/{page_id}/child/page"), params={"limit": limit, "expand": "version"})
        return _ok([
            {
                "id":    r.get("id"),
                "title": r.get("title"),
                "url":   c.base_url + "/wiki" + r.get("_links", {}).get("webui", ""),
            }
            for r in (data.get("results") or [])
        ])
    except Exception as e:
        return _err(e)


# ── SPACES ─────────────────────────────────────────────────────────────────
@app.tool()
def list_spaces(limit: int = 50) -> dict:
    """List all spaces the user can access."""
    try:
        c = client()
        data = c.get(c.v1("/space"), params={"limit": limit, "expand": "description.plain"})
        return _ok([
            {
                "key":  s.get("key"),
                "name": s.get("name"),
                "type": s.get("type"),
                "url":  c.base_url + "/wiki" + s.get("_links", {}).get("webui", ""),
            }
            for s in (data.get("results") or [])
        ])
    except Exception as e:
        return _err(e)


@app.tool()
def get_space(space_key: str) -> dict:
    """Get details of a specific space."""
    try:
        c = client()
        data = c.get(c.v1(f"/space/{space_key}"), params={"expand": "description.plain,homepage"})
        return _ok({
            "key":         data.get("key"),
            "name":        data.get("name"),
            "type":        data.get("type"),
            "description": ((data.get("description") or {}).get("plain") or {}).get("value"),
            "homepage_id": (data.get("homepage") or {}).get("id"),
            "url":         c.base_url + "/wiki" + data.get("_links", {}).get("webui", ""),
        })
    except Exception as e:
        return _err(e)


@app.tool()
def list_space_content(space_key: str, limit: int = 50) -> dict:
    """List pages within a space."""
    try:
        c = client()
        data = c.get(c.v1(f"/space/{space_key}/content/page"), params={"limit": limit})
        return _ok([
            {"id": p.get("id"), "title": p.get("title")}
            for p in (data.get("results") or [])
        ])
    except Exception as e:
        return _err(e)


@app.tool()
def get_space_id_from_key(space_key: str) -> dict:
    """Convert a space KEY to its numeric ID (needed for v2 endpoints like whiteboards)."""
    try:
        c = client()
        data = c.get(c.v2("/spaces"), params={"keys": space_key, "limit": 1})
        results = data.get("results") or []
        if not results:
            return {"ok": False, "error": f"Space '{space_key}' no encontrado"}
        s = results[0]
        return _ok({"id": s.get("id"), "key": s.get("key"), "name": s.get("name")})
    except Exception as e:
        return _err(e)


# ── ATTACHMENTS ────────────────────────────────────────────────────────────
@app.tool()
def list_attachments(page_id: str, limit: int = 50) -> dict:
    """List attachments of a page."""
    try:
        c = client()
        data = c.get(c.v1(f"/content/{page_id}/child/attachment"), params={"limit": limit})
        return _ok([
            {
                "id":        a.get("id"),
                "title":     a.get("title"),
                "mediaType": (a.get("metadata") or {}).get("mediaType"),
                "size":      (a.get("extensions") or {}).get("fileSize"),
                "url":       c.base_url + "/wiki" + (a.get("_links") or {}).get("download", ""),
            }
            for a in (data.get("results") or [])
        ])
    except Exception as e:
        return _err(e)


@app.tool()
def upload_attachment(page_id: str, file_path: str, comment: str | None = None) -> dict:
    """Upload a local file as attachment to a page."""
    try:
        c = client()
        if not os.path.isfile(file_path):
            return {"ok": False, "error": f"File not found: {file_path}"}
        with open(file_path, "rb") as fh:
            files = {"file": (os.path.basename(file_path), fh.read())}
            data = c.request("POST", c.v1(f"/content/{page_id}/child/attachment"),
                             files=files, extra_headers={"X-Atlassian-Token": "no-check"})
        results = data.get("results") if isinstance(data, dict) else None
        return _ok([
            {"id": a.get("id"), "title": a.get("title")}
            for a in (results or [data] if isinstance(data, dict) else data or [])
        ])
    except Exception as e:
        return _err(e)


@app.tool()
def delete_attachment(attachment_id: str) -> dict:
    """Delete an attachment by ID."""
    try:
        client().delete(client().v1(f"/content/{attachment_id}"))
        return _ok({"deleted": attachment_id})
    except Exception as e:
        return _err(e)


# ── COMMENTS ───────────────────────────────────────────────────────────────
@app.tool()
def list_comments(page_id: str, limit: int = 50) -> dict:
    """List comments on a page."""
    try:
        c = client()
        data = c.get(c.v1(f"/content/{page_id}/child/comment"),
                     params={"limit": limit, "expand": "body.storage,version,history"})
        return _ok([
            {
                "id":      cm.get("id"),
                "version": cm.get("version", {}).get("number"),
                "by":      ((cm.get("history") or {}).get("createdBy") or {}).get("displayName"),
                "when":    (cm.get("history") or {}).get("createdDate"),
                "body":    (cm.get("body") or {}).get("storage", {}).get("value"),
            }
            for cm in (data.get("results") or [])
        ])
    except Exception as e:
        return _err(e)


@app.tool()
def add_comment(page_id: str, body: str) -> dict:
    """Post a comment on a page (body is Storage XML / HTML-like)."""
    try:
        c = client()
        page = c.get(c.v1(f"/content/{page_id}"), params={"expand": "space"})
        payload = {
            "type": "comment",
            "container": {"id": page_id, "type": "page"},
            "space": {"key": page.get("space", {}).get("key")},
            "body": {"storage": {"value": body, "representation": "storage"}},
        }
        data = c.post(c.v1("/content"), json=payload)
        return _ok({"id": data.get("id")})
    except Exception as e:
        return _err(e)


@app.tool()
def delete_comment(comment_id: str) -> dict:
    """Delete a comment."""
    try:
        client().delete(client().v1(f"/content/{comment_id}"))
        return _ok({"deleted": comment_id})
    except Exception as e:
        return _err(e)


# ── LABELS ─────────────────────────────────────────────────────────────────
@app.tool()
def get_page_labels(page_id: str) -> dict:
    """Get labels of a page."""
    try:
        c = client()
        data = c.get(c.v1(f"/content/{page_id}/label"))
        return _ok([l.get("name") for l in (data.get("results") or [])])
    except Exception as e:
        return _err(e)


@app.tool()
def add_page_labels(page_id: str, labels: list[str]) -> dict:
    """Add one or more labels to a page."""
    try:
        c = client()
        payload = [{"prefix": "global", "name": lab} for lab in labels]
        data = c.post(c.v1(f"/content/{page_id}/label"), json=payload)
        return _ok([l.get("name") for l in (data.get("results") or [])])
    except Exception as e:
        return _err(e)


@app.tool()
def remove_page_label(page_id: str, label: str) -> dict:
    """Remove a single label from a page."""
    try:
        client().delete(client().v1(f"/content/{page_id}/label"), params={"name": label})
        return _ok({"removed": label})
    except Exception as e:
        return _err(e)


# ── WHITEBOARDS (v2 API) ───────────────────────────────────────────────────
@app.tool()
def list_whiteboards(space_id: str | None = None, limit: int = 25) -> dict:
    """List whiteboards. Filter by space_id (numeric, use get_space_id_from_key first)."""
    try:
        c = client()
        params: dict[str, Any] = {"limit": min(limit, 250)}
        if space_id:
            params["space-id"] = space_id
        data = c.get(c.v2("/whiteboards"), params=params)
        return _ok([
            {
                "id":        w.get("id"),
                "title":     w.get("title"),
                "spaceId":   w.get("spaceId"),
                "parentId":  w.get("parentId"),
                "createdAt": w.get("createdAt"),
            }
            for w in (data.get("results") or [])
        ])
    except Exception as e:
        return _err(e)


@app.tool()
def get_whiteboard(whiteboard_id: str) -> dict:
    """Fetch a whiteboard's metadata by ID."""
    try:
        data = client().get(client().v2(f"/whiteboards/{whiteboard_id}"))
        return _ok(data)
    except Exception as e:
        return _err(e)


@app.tool()
def create_whiteboard(space_id: str, title: str, parent_id: str | None = None) -> dict:
    """Create a new whiteboard. space_id is the NUMERIC id (use get_space_id_from_key)."""
    try:
        payload: dict[str, Any] = {"spaceId": space_id, "title": title}
        if parent_id:
            payload["parentId"] = parent_id
        data = client().post(client().v2("/whiteboards"), json=payload)
        return _ok({"id": data.get("id"), "title": data.get("title"), "spaceId": data.get("spaceId")})
    except Exception as e:
        return _err(e)


@app.tool()
def delete_whiteboard(whiteboard_id: str) -> dict:
    """Delete a whiteboard."""
    try:
        client().delete(client().v2(f"/whiteboards/{whiteboard_id}"))
        return _ok({"deleted": whiteboard_id})
    except Exception as e:
        return _err(e)


# ── USERS ──────────────────────────────────────────────────────────────────
@app.tool()
def get_current_user() -> dict:
    """Return info about the currently authenticated user."""
    try:
        data = client().get(client().v1("/user/current"))
        return _ok({
            "accountId":   data.get("accountId"),
            "displayName": data.get("displayName"),
            "email":       data.get("email"),
            "accountType": data.get("accountType"),
        })
    except Exception as e:
        return _err(e)


@app.tool()
def search_users(query: str, limit: int = 25) -> dict:
    """Search users by name/email."""
    try:
        c = client()
        data = c.get(c.v1("/search/user"), params={"cql": f'user.fullname ~ "{query}"', "limit": limit})
        return _ok([
            {
                "accountId":   (u.get("user") or {}).get("accountId"),
                "displayName": (u.get("user") or {}).get("displayName"),
                "email":       (u.get("user") or {}).get("email"),
            }
            for u in (data.get("results") or [])
        ])
    except Exception as e:
        return _err(e)


# ── DIAGRAMS-AS-CODE en páginas (Mermaid + drawio) ────────────────────────
# Workaround a la limitación de Whiteboards: en vez de pizarras (que no permiten
# escribir contenido visual via API), creamos PÁGINAS normales con diagramas
# embebidos. Mermaid → diagrama renderizado desde código. drawio → editor visual
# completo. Ambos son 100% editables vía API y/o UI de Confluence.

def _build_mermaid_body(mermaid_code: str, intro: str | None = None) -> str:
    """Build Confluence storage XML with a mermaid diagram.

    Tries 'mermaid-cloud' macro first (most common Atlassian Marketplace plugin).
    If your Confluence has a different mermaid plugin, edit the macro name here.
    """
    intro_html = f"<p>{intro}</p>" if intro else ""
    return (
        intro_html
        + '<ac:structured-macro ac:name="mermaid-cloud" ac:schema-version="1">'
        '<ac:plain-text-body><![CDATA[' + mermaid_code + ']]></ac:plain-text-body>'
        '</ac:structured-macro>'
    )


@app.tool()
def create_mermaid_page(
    space_key: str,
    title: str,
    mermaid_code: str,
    parent_id: str | None = None,
    intro: str | None = None,
) -> dict:
    """Create a page with an embedded Mermaid diagram.

    Args:
        space_key: Target space (e.g. "QD").
        title: Page title.
        mermaid_code: Mermaid syntax (graph TD/LR, sequenceDiagram, etc.).
        parent_id: Optional parent page ID.
        intro: Optional intro paragraph before the diagram.

    Mermaid is rendered by the 'mermaid-cloud' macro (most common in Confluence
    Marketplace). If the plugin isn't installed, the diagram won't render — you'll
    see raw text. Install one from the Atlassian Marketplace if needed.
    """
    try:
        c = client()
        body = _build_mermaid_body(mermaid_code, intro)
        payload: dict[str, Any] = {
            "type": "page",
            "title": title,
            "space": {"key": space_key},
            "body": {"storage": {"value": body, "representation": "storage"}},
        }
        if parent_id:
            payload["ancestors"] = [{"id": parent_id}]
        data = c.post(c.v1("/content"), json=payload)
        return _ok({
            "id":    data.get("id"),
            "title": data.get("title"),
            "url":   c.base_url + "/wiki" + data.get("_links", {}).get("webui", ""),
        })
    except Exception as e:
        return _err(e)


@app.tool()
def update_mermaid_diagram(page_id: str, mermaid_code: str, intro: str | None = None) -> dict:
    """Replace the body of a page with a new mermaid diagram (keeps title/space).

    Useful to iterate on a flow: agent edits the mermaid code and re-pushes.
    """
    try:
        c = client()
        current = c.get(c.v1(f"/content/{page_id}"), params={"expand": "version,space"})
        new_body = _build_mermaid_body(mermaid_code, intro)
        new_version = (current.get("version", {}).get("number") or 0) + 1
        payload = {
            "id": page_id,
            "type": current.get("type", "page"),
            "title": current.get("title"),
            "space": {"key": current.get("space", {}).get("key")},
            "version": {"number": new_version},
            "body": {"storage": {"value": new_body, "representation": "storage"}},
        }
        data = c.put(c.v1(f"/content/{page_id}"), json=payload)
        return _ok({"id": data.get("id"), "version": data.get("version", {}).get("number")})
    except Exception as e:
        return _err(e)


@app.tool()
def create_drawio_page(
    space_key: str,
    title: str,
    parent_id: str | None = None,
    diagram_name: str = "diagram",
) -> dict:
    """Create a page with an EMPTY drawio (diagrams.net) diagram ready to edit from the UI.

    The drawio macro is one of the most popular Confluence apps. If installed,
    your team can edit visually from the page. If not installed, the macro
    appears as a placeholder. Install from Marketplace if needed.
    """
    try:
        c = client()
        body = (
            f'<ac:structured-macro ac:name="drawio" ac:schema-version="1">'
            f'<ac:parameter ac:name="diagramName">{diagram_name}</ac:parameter>'
            f'<ac:parameter ac:name="diagramDisplayName">{diagram_name}</ac:parameter>'
            f'<ac:parameter ac:name="lbox">1</ac:parameter>'
            f'<ac:parameter ac:name="contentVer">1</ac:parameter>'
            f'</ac:structured-macro>'
        )
        payload: dict[str, Any] = {
            "type": "page",
            "title": title,
            "space": {"key": space_key},
            "body": {"storage": {"value": body, "representation": "storage"}},
        }
        if parent_id:
            payload["ancestors"] = [{"id": parent_id}]
        data = c.post(c.v1("/content"), json=payload)
        return _ok({
            "id":    data.get("id"),
            "title": data.get("title"),
            "url":   c.base_url + "/wiki" + data.get("_links", {}).get("webui", ""),
        })
    except Exception as e:
        return _err(e)


# ── Raw CQL ────────────────────────────────────────────────────────────────
@app.tool()
def cql_search(cql: str, limit: int = 25) -> dict:
    """Run a raw CQL query (any content type)."""
    try:
        c = client()
        data = c.get(c.v1("/content/search"), params={"cql": cql, "limit": min(limit, 100)})
        return _ok([
            {
                "id":    r.get("id"),
                "type":  r.get("type"),
                "title": r.get("title"),
                "space": (r.get("space") or {}).get("key"),
                "url":   c.base_url + "/wiki" + (r.get("_links") or {}).get("webui", ""),
            }
            for r in (data.get("results") or [])
        ])
    except Exception as e:
        return _err(e)


def main() -> None:
    """Run the MCP server over stdio."""
    app.run()


if __name__ == "__main__":
    main()
