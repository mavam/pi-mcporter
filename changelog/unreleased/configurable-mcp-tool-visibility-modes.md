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

Direct-mode tools are preloaded during extension startup so they are available when the agent begins, while slow or unavailable MCP servers no longer block startup or prevent later schema inspection.
