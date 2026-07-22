pi-mcporter introduces strict, layered exposure policies for choosing how MCP tools reach the model while moving connectivity and credentials fully into MCPorter. It also restores current OAuth compatibility and makes server discovery reliable when tool metadata is unavailable.

## 💥 Breaking changes

### Configurable MCP tool exposure

pi-mcporter replaces the `lazy`, `index`, and `preload` modes with four exposure levels: `on-demand`, `index`, `match`, and `native`. The default `index` policy keeps a small, stable server hint. `match` adds prompt-relevant tool signatures as a hidden turn message, and `native` registers an explicitly selected set of MCP tools as direct Pi tools.

Exposure configuration now uses a strict, versioned schema. Put global settings in the Pi agent directory's `mcporter.json` and project settings in `<cwd>/.pi/mcporter.json`. Project scalar values override global values, project server policies replace complete global server policies, and `null` removes an inherited policy.

The extension re-reads both layers at session start and before each agent request. Schema discovery uses stale-while-refresh caching and one configurable cold-start budget; failed catalog fetches retry within 30 seconds. Hidden `match` messages are emitted only when their content changes between turns. Run `/mcporter status` to inspect the resolved settings, cache state, discovery failures, and native tool registrations without starting a cold MCP runtime.

This change intentionally removes the old `mode`, `serverModes`, and top-level `timeoutMs` settings without compatibility aliases.

*By @mavam and @codex in #10.*

### Current MCPorter OAuth compatibility

OAuth-authenticated MCP servers now use the same current MCPorter credential handling in Pi as in the MCPorter CLI. This fixes authorization failures such as Linear returning HTTP 401 in Pi after a successful `mcporter auth linear` login.

This update requires Node.js 24 or newer.

*By @mavam and @codex in #11.*

### MCP server configuration moved to MCPorter

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
  "version": 1,
  "defaultExposure": "index",
  "servers": {
    "excalidraw": {
      "exposure": "match"
    }
  }
}
```

This is a hard cut that removes pi-mcporter's `!command` secret execution and inline server support. The clearer layering avoids competing configuration systems: MCPorter owns MCP connectivity and credentials, while pi-mcporter controls how MCP servers and tools are exposed to the model.

*By @mavam and @codex in #9.*

## 🐞 Bug fixes

### Reliable MCP server discovery

The `mcporter` search action now finds known MCP server names as well as matching tools, including when authentication or connectivity prevents the server's tool metadata from loading. Natural-language capability queries also ignore common model-oriented filler:

```json
{ "action": "search", "query": "find a tool for creating Linear issues" }
```

Search results distinguish server names from callable `server.tool` selectors and provide recovery guidance for unavailable servers.

*By @mavam and @codex in #12.*
