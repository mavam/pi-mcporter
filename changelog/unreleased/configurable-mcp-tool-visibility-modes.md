---
title: Configurable MCP tool visibility modes
type: feature
authors:
  - mavam
  - codex
pr: 3
created: 2026-03-10T08:22:08.798166Z
---

Pi MCPorter now lets users choose between fully lazy operation and prompt-oriented catalog preloading while keeping all MCP access behind the stable `mcporter` interface.

Malformed settings, missing runtime config, slow servers, and unavailable MCP servers no longer abort agent startup. Prompt preloading retries after transient failures and refreshes cached catalog metadata after TTL expiry.

Configuration is now sourced from `~/.pi/agent/mcporter.json`, `MCPORTER_CONFIG`, and per-call `timeoutMs`. The legacy `--mcporter-config` and `--mcporter-timeout-ms` extension flags are no longer supported.
