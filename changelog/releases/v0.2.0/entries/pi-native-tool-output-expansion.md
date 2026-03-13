---
title: Pi-native tool output expansion
type: change
authors:
  - mavam
  - codex
pr: 1
created: 2026-03-07T09:24:05.649164Z
---

Pi MCPorter tool output now follows pi's built-in expand and collapse behavior instead of maintaining a separate `/mcporter` output mode. Collapsed results show a compact summary for `search`, `describe`, and `call`, and expanded results show the full rendered output using pi's existing `expandTools` keybinding (default `Ctrl+O`).

This keeps the extension behavior aligned with the rest of pi and removes an extra per-extension setting that users would otherwise need to discover and maintain.
