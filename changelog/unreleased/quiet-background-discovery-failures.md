---
title: Quiet background discovery failures
type: bugfix
authors:
  - mavam
  - codex
prs:
  - 14
created: 2026-07-22T21:00:55.281563Z
---

Background schema discovery failures from individual MCP servers no longer show warning notifications in every Pi session. Use `/mcporter status` to inspect unavailable servers and their errors while healthy integrations remain available.
