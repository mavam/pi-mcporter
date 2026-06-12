---
title: Per-server context preloading modes
type: feature
authors:
  - mavam
  - claude
prs:
  - 5
created: 2026-06-12T06:04:11.248716Z
---

The catalog visibility `mode` can now be set per server, and a new `index` mode becomes the default.

Each entry in the `mcpServers` overlay of `~/.pi/agent/mcporter.json` accepts its own `mode`, overriding the top-level default. This lets you preload the catalogs of frequently used servers while keeping the long tail out of context:

```json
{
  "mcpServers": {
    "linear": { "mode": "preload" },
    "playwright": { "mode": "lazy" }
  }
}
```

The three modes:

- `index` (new default): appends a one-line list of reachable MCP server names to the system prompt, so the agent knows what exists for a handful of tokens.
- `lazy`: zero context impact; nothing is injected and no runtime starts until first use. Previously the default; configure it explicitly to restore the old behavior.
- `preload`: warms the server's tool catalog and lists its selectors in the system prompt so the agent can skip discovery and call tools directly. The sync now runs in the background and no longer delays agent start: on the first turn the server appears as a plain index entry, and warmed selectors show up once the sync completes.
