# Jira & Confluence QA Toolkit

A self-hosted QA management platform that integrates with Atlassian Jira and Confluence Cloud APIs. Built with vanilla Node.js (zero dependencies), it provides a complete workflow for creating, tracking, and reporting test cases directly from a local web interface.

## Features

### QA Test Case Manager (`Qa_form.html`)
- Create structured QA test cases as Jira issues with ADF (Atlassian Document Format) rich content
- Auto-generated tables with test metadata, steps, expected vs actual results
- Version management system tied to Jira releases
- Edit existing test cases inline
- Epic-based organization with persistent filters

### Bug & Tech Task Reporter (`bg_reporter.js`)
- Create linked bug reports (BG project) and technical tasks (SP project) from any test case
- Cross-project assignee selection with intersection logic
- Auto-linked issues with full traceability back to the originating test case

### Bulk Test Case Generator (`bulk-epic.js`)
- Scans Epic descriptions for `QA_STRUCTURE` JSON configuration
- Detects missing test cases by cross-referencing configured vs executed tests
- Batch-creates all missing test cases with proper ADF structure

### QA History & Metrics (`history.html`)
- Full execution history with filtering by Epic, version, and status
- Missing test case panel per Epic
- Direct links to Jira issues for quick navigation

### Bug Verification Dashboard (`bg_verificacion.html`)
- Review and verify reported bugs
- Transition issues through Jira workflows
- Filter by Epic with persistent preferences

### Activities Tracker (`actividades.html`)
- Step-by-step activity logging
- Dual mode: simple text or structured steps
- Linked to Jira issues with auto-generated ADF content

### Jira JSON Editor (`jira_editor.html`)
- Direct JSON editor for Epic `QA_STRUCTURE` descriptions
- Syntax-highlighted code editor with validation
- Schema hints and live status bar

### Confluence MCP Server (`mcp-confluence/`)
- Model Context Protocol server exposing 25+ Confluence operations as tools
- Compatible with Claude Desktop, Claude Code, Cursor, and any MCP client
- Operations: pages, spaces, attachments, comments, labels, whiteboards, users, CQL queries
- Built with Python, `mcp` SDK, and `httpx`

### Responsive Proxy (`responsive-proxy/`)
- LAN proxy for testing the app on tablets and mobile devices
- Host spoofing, CORS injection, and JS bundle rewriting on the fly
- Zero dependencies, pure Node.js

## Tech Stack

- **Backend**: Node.js (vanilla HTTP/HTTPS, zero dependencies)
- **Frontend**: Vanilla HTML/CSS/JS with custom component architecture
- **APIs**: Jira REST API v3, Confluence REST API v1/v2
- **Auth**: Basic auth with Atlassian API tokens
- **MCP Server**: Python 3, `mcp` SDK, `httpx`

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/henao06/Jira-and-confluence-.git
cd Jira-and-confluence-

# 2. Create .env from template
cp .env.example .env

# 3. Configure your Atlassian credentials
#    - JIRA_HOST: your-domain.atlassian.net
#    - JIRA_EMAIL: your email
#    - JIRA_TOKEN: API token from https://id.atlassian.com/manage-profile/security/api-tokens
#    - PORT: server port (e.g. 8080)

# 4. Run the server
node Server.JS

# 5. Open in browser
open http://localhost:8080
```

## Project Structure

```
Server.JS              # Local HTTP server with Jira API proxy
Qa_form.html           # QA test case creation form
history.html           # Test execution history & metrics
bg_verificacion.html   # Bug verification dashboard
actividades.html       # Activity tracker
jira_editor.html       # JSON editor for Epic QA structures
bulk-epic.js           # Bulk test case generator
bg_reporter.js         # Bug & tech task reporter
epic-filter.js         # Persistent Epic filter component
releases.js            # Jira version management
styles.css             # Shared styles
mcp-confluence/        # Confluence MCP server (Python)
responsive-proxy/      # LAN proxy for mobile testing
```

## License

MIT
