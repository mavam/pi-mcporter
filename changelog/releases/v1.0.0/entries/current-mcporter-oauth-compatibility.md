---
title: Current MCPorter OAuth compatibility
type: breaking
authors:
  - mavam
  - codex
prs:
  - 11
created: 2026-07-22T20:21:54.422917Z
---

OAuth-authenticated MCP servers now use the same current MCPorter credential handling in Pi as in the MCPorter CLI. This fixes authorization failures such as Linear returning HTTP 401 in Pi after a successful `mcporter auth linear` login.

This update requires Node.js 24 or newer.
