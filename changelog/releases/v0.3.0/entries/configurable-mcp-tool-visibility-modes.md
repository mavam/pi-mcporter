---
title: Configurable MCP tool loading modes
type: feature
authors:
  - mavam
  - codex
pr: 3
created: 2026-03-10T08:22:08.798166Z
---

Pi MCPorter now lets you choose between lazy loading and catalog preloading for MCP tools, while still routing all MCP access through the stable `mcporter` interface. In preload mode, pi warms MCP tool metadata before the agent starts so it can more often skip discovery and call the right tool directly.

Malformed settings, missing configuration, slow servers, and unavailable MCP servers no longer abort agent startup. Preloading now retries after transient failures and refreshes cached catalog data after it expires.

Configuration now comes from `~/.pi/agent/mcporter.json`, `MCPORTER_CONFIG`, and per-call `timeoutMs`. The legacy `--mcporter-config` and `--mcporter-timeout-ms` extension flags are no longer supported.
