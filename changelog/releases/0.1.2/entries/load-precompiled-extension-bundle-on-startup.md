---
title: Load precompiled extension bundle on startup
type: bugfix
authors:
  - mavam
  - claude
created: 2026-02-28T15:45:08.545575Z
---

Ship a precompiled dist/index.js bundle and register that as the extension entrypoint instead of loading TypeScript sources at runtime. This reduces startup overhead from jiti transpilation and module graph loading during pi launch.
