---
title: Configurable MCP tool visibility modes
type: feature
authors:
  - mavam
  - codex
pr: 3
created: 2026-03-10T08:22:08.798166Z
---

Pi MCPorter now lets users choose how MCP tools appear in pi. Users can keep tools behind the stable `mcporter` interface, hoist them eagerly, or expose them directly, and can override the visibility mode per MCP server.

Direct-mode tools are warmed through pi's startup hooks so they are available when the agent begins, while malformed settings, missing runtime config, slow servers, and unavailable MCP servers now degrade to startup warnings instead of aborting agent startup.

Configuration is now sourced from `~/.pi/agent/mcporter.json`, `MCPORTER_CONFIG`, and per-call `timeoutMs`. The legacy `--mcporter-config` and `--mcporter-timeout-ms` extension flags are no longer supported.
