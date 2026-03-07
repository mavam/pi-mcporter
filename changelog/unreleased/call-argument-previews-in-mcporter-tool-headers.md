---
title: Call argument previews in mcporter tool headers
type: feature
authors:
  - mavam
  - codex
pr: 2
created: 2026-03-07T10:14:49.080346Z
---

`mcporter call` headers now show a compact preview of the arguments being sent, so users can confirm tool inputs without expanding the full tool call output. For example, a call such as `mcporter call linear.list_issues` can now show `team=PI limit=10 state=Todo`, and multiline `argsJson` payloads are compacted into a single readable line.

This makes it easier to review tool invocations at a glance while still truncating long previews to fit the available header width.
