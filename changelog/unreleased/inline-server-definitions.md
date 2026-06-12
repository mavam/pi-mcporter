---
title: Inline server definitions
type: feature
authors:
  - mavam
  - claude
created: 2026-06-12T08:50:00Z
---

Servers can now be defined entirely in `~/.pi/agent/mcporter.json`, without a matching entry in the MCPorter config. An `mcpServers` entry that sets `command` (stdio) or `url` (HTTP) becomes a full server definition:

```json
{
  "mcpServers": {
    "everything": {
      "command": "npx -y @modelcontextprotocol/server-everything"
    },
    "excalidraw": {
      "url": "https://api.excalidraw.com/api/v1/mcp",
      "headers": {
        "Authorization": "!security find-generic-password -s 'excalidraw-api-key' -w"
      },
      "mode": "preload"
    }
  }
}
```

This removes the config sprawl of maintaining both files for servers that only pi uses, while keeping the existing goodness: command-backed `env` secrets, per-server `mode`, and composition with the MCPorter config. HTTP `headers` values support the same secret syntax as `env` (`!command`, `$env:VAR`, `${VAR}`). On a name collision, the inline definition takes precedence over the MCPorter config.
