---
title: Configurable MCP tool exposure
type: breaking
authors:
  - mavam
  - codex
prs:
  - 10
created: 2026-07-13T00:00:00.000Z
---

pi-mcporter replaces the `lazy`, `index`, and `preload` modes with four exposure levels: `on-demand`, `index`, `match`, and `native`. The default `index` policy keeps a small, stable server hint. `match` adds prompt-relevant tool signatures as a hidden turn message, and `native` registers an explicitly selected set of MCP tools as direct Pi tools.

Exposure configuration now uses a strict, versioned schema. Put global settings in the Pi agent directory's `mcporter.json` and project settings in `<cwd>/.pi/mcporter.json`. Project scalar values override global values, project server policies replace complete global server policies, and `null` removes an inherited policy.

The extension re-reads both layers at session start and before each agent request. Schema discovery uses stale-while-refresh caching and one configurable cold-start budget. Run `/mcporter status` to inspect the resolved settings, cache state, discovery failures, and native tool registrations without starting a cold MCP runtime.

This change intentionally removes the old `mode`, `serverModes`, and top-level `timeoutMs` settings without compatibility aliases.
