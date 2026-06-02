"""HTTP client for the Atlassian Confluence Cloud REST API.

Handles auth (Basic with email + API token) and provides both v1
(`/wiki/rest/api`) and v2 (`/wiki/api/v2`) base URLs.
"""
from __future__ import annotations

import base64
import os
from typing import Any

import httpx

DEFAULT_TIMEOUT = 30.0


class ConfluenceError(RuntimeError):
    def __init__(self, status: int, message: str, body: Any = None) -> None:
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.body = body


class ConfluenceClient:
    def __init__(
        self,
        base_url: str | None = None,
        email: str | None = None,
        token: str | None = None,
        default_space: str | None = None,
    ) -> None:
        self.base_url = (base_url or os.getenv("CONFLUENCE_BASE_URL", "")).rstrip("/")
        self.email = email or os.getenv("CONFLUENCE_EMAIL", "")
        self.token = token or os.getenv("CONFLUENCE_TOKEN", "")
        self.default_space = default_space or os.getenv("CONFLUENCE_DEFAULT_SPACE")

        if not self.base_url or not self.email or not self.token:
            raise RuntimeError(
                "Falta configuración. Definí CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL y "
                "CONFLUENCE_TOKEN como variables de entorno o argumentos."
            )

        auth_str = f"{self.email}:{self.token}"
        self._auth_header = "Basic " + base64.b64encode(auth_str.encode()).decode()
        self._client = httpx.Client(timeout=DEFAULT_TIMEOUT)

    def v1(self, path: str) -> str:
        return f"{self.base_url}/wiki/rest/api{path}"

    def v2(self, path: str) -> str:
        return f"{self.base_url}/wiki/api/v2{path}"

    def request(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any | None = None,
        files: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        headers = {
            "Authorization": self._auth_header,
            "Accept": "application/json",
        }
        if json is not None and files is None:
            headers["Content-Type"] = "application/json"
        if files is not None:
            headers["X-Atlassian-Token"] = "no-check"
        if extra_headers:
            headers.update(extra_headers)

        response = self._client.request(
            method, url, params=params, json=json, files=files, headers=headers,
        )

        if response.status_code >= 400:
            try:
                body = response.json()
                msg = body.get("message") or body.get("error") or response.text[:200]
            except Exception:
                body = response.text
                msg = response.text[:200]
            raise ConfluenceError(response.status_code, msg, body)

        if response.status_code == 204 or not response.content:
            return None
        try:
            return response.json()
        except Exception:
            return response.text

    def get(self, url: str, **kw: Any) -> Any:    return self.request("GET", url, **kw)
    def post(self, url: str, **kw: Any) -> Any:   return self.request("POST", url, **kw)
    def put(self, url: str, **kw: Any) -> Any:    return self.request("PUT", url, **kw)
    def delete(self, url: str, **kw: Any) -> Any: return self.request("DELETE", url, **kw)

    def close(self) -> None:
        self._client.close()
