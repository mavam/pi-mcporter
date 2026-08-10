---
title: Clean startup with legacy stdio servers
type: bugfix
authors:
  - mavam
  - codex
created: 2026-08-10T06:18:54.30858Z
---

Pi's terminal display now stays intact when a stdio MCP server rejects MCPorter's initial protocol negotiation probe. Compatible legacy servers still reconnect automatically.
