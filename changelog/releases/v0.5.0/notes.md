This release makes Pi MCPorter easier to configure by letting agents discover MCP servers from lightweight index entries, preload selected server catalogs, and define pi-only MCP servers directly in the agent configuration. It reduces startup friction while preserving lazy loading and secret-backed server definitions for larger MCP setups.

## 🚀 Features

### Inline server definitions

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

*By @mavam and @claude in #6.*

### Per-server context preloading modes

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

*By @mavam and @claude in #5.*
