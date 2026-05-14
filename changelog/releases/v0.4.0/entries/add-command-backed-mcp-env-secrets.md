---
title: Add command-backed MCP env secrets
type: feature
authors:
  - mavam
pr: 4
created: 2026-05-13T12:51:38.744107Z
---

Adds a per-server `mcpServers.<name>.env` overlay for pi-mcporter so users can provide MCP server secrets through literal values, environment variables, or command-backed values without storing credentials in MCPorter config files.
