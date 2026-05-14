This release lets Pi MCPorter inject per-server MCP environment secrets from literals, environment variables, and commands while keeping credentials out of MCPorter config files. It also improves MCP tool output rendering with clearer Markdown sections and Pi's native expand/collapse behavior.

## 🚀 Features

### Add command-backed MCP env secrets

Adds a per-server `mcpServers.<name>.env` overlay for pi-mcporter so users can provide MCP server secrets through literal values, environment variables, or command-backed values without storing credentials in MCPorter config files.

*By @mavam in #4.*

## 🔧 Changes

### Improve MCP tool rendering

MCP tool output now renders as Markdown: search results use clearer tool bullets, describe output uses headings and fenced schema snippets, and call results use structured sections for text, JSON, and raw payloads. Collapsed tool output uses Pi's expand/collapse affordance while keeping full details hidden until expanded.

*By @mavam in #4.*
