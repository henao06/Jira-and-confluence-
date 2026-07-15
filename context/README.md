# Context · Proyecto QA Tool

Carpeta de contexto autogestionada. Leer en este orden para entender el proyecto.

## Índice

| Archivo | Contenido | Cuándo leer |
|---------|-----------|-------------|
| [README.md](README.md) | Este overview | Siempre primero |
| [architecture.md](architecture.md) | Server.JS, archivos, data flow | Cualquier tarea de código |
| [config.md](config.md) | Sistema de config: `.env` → `APP_CONFIG` | Antes de tocar valores org-específicos |
| [jira.md](jira.md) | Proyectos, custom fields, endpoints, ADF | Cualquier tarea que toque Jira |
| [flows.md](flows.md) | Flujos de usuario por página | Para entender qué hace cada pantalla |
| [conventions.md](conventions.md) | Patrones de código + ADF helpers | Antes de escribir código |
| [current-state.md](current-state.md) | Estado actual + cambios recientes + TODO | Siempre al inicio de sesión |

## Overview en 60 segundos

**Qué es**: Aplicación para gestionar la ejecución de Test Cases en Jira (Atlassian Cloud). Es **org-neutral**: el dominio Jira, las keys de proyecto, custom fields, epics y branding se configuran vía `.env` → `window.APP_CONFIG` (ver [config.md](config.md)). Los valores como QAA/BG que aparecen abajo son **ejemplos** de una instancia real, no valores fijos.

**Para qué sirve**:
- Ejecutar test cases manualmente (Qa_form.html) → crea issue en Jira (proyecto QA, ej. QAA)
- Verificar bugs reportados (bg_verificacion.html) → genera subtareas QAA con trazabilidad bidireccional
- Generar TCs faltantes en bloque por Epic (bulk-epic en bg_verificacion.html)
- Ver historial, cobertura, releases (history.html, actividades.html)

**Stack**: Vanilla HTML + JS + CSS inline. Sin frameworks. Sin build step. Server.JS es un proxy Node.js sin dependencias externas a Jira REST API v3.

**Convención clave**: TODO call a Jira pasa por `window.location.origin + '/jira'` (el server lo reescribe a Atlassian + agrega auth + agrega custom fields de email/displayName).

## Archivos en el repo (raíz)

```
Server.JS                  ← Proxy HTTP a Jira + serve estáticos
Qa_form.html               ← Form de ejecución de TC (la pantalla principal)
bg_verificacion.html       ← Verificación de bugs BG → QAA (con tab Bulk Epic)
bulk-epic.js               ← Lógica de creación masiva por Epic
history.html               ← Historial de TCs ejecutados
actividades.html           ← Tablero de actividades
jira_editor.html           ← Editor JSON de issues
epic-filter.js             ← Filtro persistente de epics (compartido entre pages)
releases.js                ← Gestión de versiones/releases
bg_reporter.js             ← Helper para reportar bugs BG
styles.css                 ← Estilos compartidos
README.md                  ← Doc humana
QA_GUIDE.md                ← Guía de uso
IMPLEMENTATION(1).md       ← Doc histórica de implementación
context/                   ← ESTE directorio (Claude lee acá)
CLAUDE.md                  ← Puerta de entrada para Claude
chatkit_uploads/           ← Archivos subidos (no tocar)
```

## Reglas para mantener este directorio

1. **Después de cualquier cambio significativo**, actualizar `current-state.md` con entrada nueva en "Cambios recientes"
2. **Si se toca la integración con Jira** (custom field nuevo, endpoint distinto), actualizar `jira.md`
3. **Si se agrega una pantalla/flow**, agregarlo a `flows.md`
4. **Si emerge una nueva convención**, sumarla a `conventions.md`
5. **Mantener este README como índice puro** — no embeber detalle acá, linkear a los archivos
