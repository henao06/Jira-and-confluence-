# Proyecto: QA Tool (org-neutral)

> Este archivo lo lee Claude Code automáticamente al iniciar cualquier sesión en este proyecto.
> Es la **puerta de entrada** al contexto. No borrar ni renombrar.

---

## INSTRUCCIÓN OBLIGATORIA

**Antes de hacer cualquier cosa en este proyecto**, leé el directorio `context/`:

1. `context/README.md` — índice + overview rápido (LEER PRIMERO)
2. `context/architecture.md` — estructura técnica
3. `context/jira.md` — integración con Jira (custom fields, endpoints, proyectos)
4. `context/flows.md` — flujos de usuario principales
5. `context/conventions.md` — patrones de código del proyecto
6. `context/current-state.md` — estado actual + cambios recientes + TODOs

**Después de cambios significativos** (nueva feature, refactor importante, decisión arquitectónica), ACTUALIZÁ:
- `context/current-state.md` con la nueva entrada en "Cambios recientes"
- El archivo específico afectado (ej. si tocás Jira → `jira.md`)

Si añadís funcionalidad nueva relevante al flujo de usuario, agregala a `flows.md`.

---

## Reglas rápidas del proyecto

- **Stack**: Node.js (Server.JS) + HTML/JS vanilla (sin framework, sin build)
- **Proxy**: todos los calls a Jira van por `window.location.origin + '/jira'`
- **Auth**: Server.JS inyecta auth + custom fields automáticamente (no hay que pasar headers Authorization desde el cliente)
- **Estilo**: CSS inline en cada HTML (con algo compartido en `styles.css`)
- **No**: emojis en commits, comentarios "Co-Authored-By", `console.log` excesivos, comentarios obvios

## Convenciones de commits

- Conventional commits sin atribución AI
- Mensajes en español o inglés, breves
- NUNCA `--no-verify`, NUNCA force-push a `main`

## Contacto y configuración

- Usuario: `tu-email@empresa.com`
- Jira: `tu-empresa.atlassian.net`
- Proyectos principales: se configuran vía `.env` (`QA_PROJECT` / `BUG_PROJECT`, ej. **QAA** / **BG**). Ver `context/config.md`.
- La herramienta es org-neutral: dominio, proyectos, custom fields, epics y branding salen de `.env` → `window.APP_CONFIG` (no hay valores de tu organización hardcodeados en el código).
