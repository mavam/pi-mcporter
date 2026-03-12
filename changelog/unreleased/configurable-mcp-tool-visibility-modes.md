---
title: Configurable MCP tool visibility modes
type: feature
authors:
  - mavam
  - codex
pr: 3
created: 2026-03-10T08:22:08.798166Z
---

Pi MCPorter now lets users choose how MCP tools appear in pi. Users can keep tools behind the stable `mcporter` interface, preload metadata eagerly, or request direct exposure, and can override the visibility mode per MCP server.

When the current pi host cannot scope custom-tool registrations to a session, direct exposure falls back to preload with a startup warning instead of leaking `mcp__*` tools across later sessions. Malformed settings, missing runtime config, slow servers, and unavailable MCP servers still degrade to startup warnings instead of aborting agent startup.

Configuration is now sourced from `~/.pi/agent/mcporter.json`, `MCPORTER_CONFIG`, and per-call `timeoutMs`. The legacy `--mcporter-config` and `--mcporter-timeout-ms` extension flags are no longer supported.
