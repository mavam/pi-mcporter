---
title: MCP server configuration moved to MCPorter
type: breaking
authors:
  - mavam
  - codex
prs:
  - 9
created: 2026-07-06T11:26:29.472823Z
---

pi-mcporter no longer accepts MCP server definitions or command-backed secrets in `~/.pi/agent/mcporter.json`. Server transports, headers, environment variables, imports, OAuth settings, and any secret resolution now belong in MCPorter's own configuration files, such as `~/.mcporter/mcporter.json` or `config/mcporter.json`.

Before, pi-mcporter accepted server overlays like this:

```json
{
  "mcpServers": {
    "excalidraw": {
      "env": {
        "EXCALIDRAW_API_KEY": "!security find-generic-password -s excalidraw-api-key -w"
      },
      "mode": "preload"
    }
  }
}
```

After this change, move the server configuration to MCPorter and keep only pi-specific orchestration in `~/.pi/agent/mcporter.json`:

```json
{
  "mode": "index",
  "serverModes": {
    "excalidraw": "preload"
  }
}
```

This is a hard cut that removes pi-mcporter's `!command` secret execution and inline server support again. The clearer layering avoids competing configuration systems: MCPorter owns MCP connectivity and credentials, while pi-mcporter only decides how much MCP catalog metadata to expose to the agent.
