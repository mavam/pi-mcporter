---
title: Add configurable mcporter call output mode
type: feature
author: mavam
pr: 1
created: 2026-03-06T11:07:27.282436Z
---

Pi MCPorter now includes a global `/mcporter` setting that lets you control how successful MCP tool call output is shown in pi. You can choose between `full`, `summary`, and `off`, depending on whether you want to always see the full result, keep the interface compact with a short summary, or hide the rendered output entirely.

This makes mcporter easier to use in longer sessions where large tool responses can add noise and make it harder to scan what happened. The new setting gives you a cleaner default experience without removing access to the underlying result when you want it, and makes it easier to tune mcporter to match how much tool output you prefer to see in the UI.
