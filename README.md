# 🧳 pi-mcporter

Use MCP tools from [pi](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent) through a stable `mcporter` proxy with optional native tool exposure, powered by [MCPorter](https://github.com/openclaw/mcporter).

## 🧠 Philosophy: CLI > MCP

- **pi is fundamentally CLI-first.**
- Prefer native CLIs whenever available (`gh`, `git`, `kubectl`, `aws`, etc.).
- Use MCP via `mcporter` when it adds clear value (for example: Linear, Slack, hosted auth-heavy integrations, cross-tool workflows).
- This package is intentionally a **thin bridge**, not a replacement for pi’s normal tool-driven workflow.

## ✨ Why use this package

- Starts with one stable `mcporter` proxy and lets you opt selected MCP tools into richer exposure
- Uses your MCPorter config/runtime as source of truth
- Supports discovery (`search`), schema help (`describe`), and execution (`call`)
- Returns useful error hints for auth/offline/http/stdio failures

## 📋 Prerequisites

You need [MCPorter](https://github.com/openclaw/mcporter) installed and configured with at least one MCP server:

```bash
npm install -g mcporter
npx mcporter list          # verify your servers are visible
```

## 🚀 Installation

```sh
pi install npm:pi-mcporter
```

## 🚀 Quick start

1. Confirm MCPorter sees your servers:

```bash
npx mcporter list
```

2. Start pi:

```bash
pi
```

3. Ask for what you need and pi picks the right MCP tools automatically:

- `What are my open Linear issues this sprint?`
- `Catch me up on #engineering in Slack from today.`
- `Find the onboarding runbook in Notion and summarize the setup steps.`

## 🔍 The three actions

The `mcporter` tool has three actions that map to a natural discovery → execution workflow.

### `search`: find tools by keyword

Use when you don't know the exact server or tool name.

```json
{ "action": "search", "query": "linear issue", "limit": 5 }
```

Returns matching selectors with short descriptions:

```
linear.create_issue — Create a new issue in a Linear team
linear.list_issues  — List issues matching a filter
```

### `describe`: get the full schema for a tool

Use when you know the selector but need to see its required parameters before calling.

```json
{ "action": "describe", "selector": "linear.create_issue" }
```

Returns the full JSON Schema for the tool's input, including required vs. optional fields and their types.

### `call`: invoke a tool

Use once you know the selector and its schema.

```json
{
  "action": "call",
  "selector": "linear.create_issue",
  "args": { "title": "Fix login bug", "teamId": "TEAM-1", "priority": 2 }
}
```

For arguments that are awkward to express as nested JSON, you can pass them as a JSON string via `argsJson` instead of `args`.

### Typical workflow

```
search "linear issue"          →  discover: linear.create_issue
describe linear.create_issue   →  learn required fields: title, teamId
call linear.create_issue       →  execute with those fields
```

In practice, pi follows this pattern automatically. The `match` and `native` exposure levels can skip some or all of these discovery steps for tools you use often.

## 🔥 Exposure levels

The exposure level controls how much the model can see before it uses the `mcporter` proxy. The default is `index`.

| Exposure | What the model sees | How calls work |
| --- | --- | --- |
| `on-demand` | No server or tool hint. | The model discovers and calls tools through `mcporter`. Exposure setup doesn't start the runtime. |
| `index` | A stable list of MCP server names in the system prompt. | The model uses `mcporter` to search, describe, and call tools. |
| `match` | The server index plus compact signatures for tools relevant to the current user prompt. | The signatures arrive as a hidden turn message, which avoids changing the system prompt for each query. Calls still use `mcporter`. |
| `native` | Selected MCP tools as individual Pi tools. | Pi calls the MCP tool directly. The `mcporter` proxy remains available as a fallback when it is active. |

`match` and `native` load schema metadata in the background at session start. On a cold turn, all servers share the configured discovery budget, which defaults to 2 seconds. When the proxy is active, a server that misses the budget remains an `index` entry for that turn while discovery continues. After a catalog entry reaches its five-minute freshness limit, pi-mcporter serves the stale in-memory entry while it refreshes it; failed catalog fetches retry within 30 seconds. The cache isn't written to disk. pi-mcporter skips the hidden `match` message when its content is identical to the previous turn's, so repeated prompts don't accumulate duplicate context.

You can set a default exposure for all servers and replace it per server. Native exposure is deliberately explicit: it is valid only in a server policy with a nonempty `includeTools` list. Use `["*"]` when you intend to expose every tool from that server.

```json
{
  "version": 1,
  "defaultExposure": "index",
  "servers": {
    "linear": {
      "exposure": "native",
      "includeTools": ["list_*", "create_issue"],
      "excludeTools": ["*_private"]
    },
    "slack": {
      "exposure": "match",
      "includeTools": ["search_*", "post_message"]
    },
    "playwright": {
      "exposure": "on-demand"
    }
  }
}
```

Tool filters support `*` and `?`. Exclusions take precedence over inclusions. Filters affect only `match` and `native` exposure; every server tool remains reachable through the proxy.

Native tools normally use the name `mcp__<server>__<tool>`. To stay compatible with providers that accept only `A-Z`, `a-z`, `0-9`, `_`, and `-` in names up to 64 characters, pi-mcporter normalizes unusual or long selectors and appends `__` plus the first 10 lowercase hexadecimal characters of the selector's SHA-256 hash. It skips name collisions and invalid input schemas and reports them through `/mcporter status`.

If the `mcporter` proxy is inactive, pi-mcporter omits `index` and `match` context. Explicit native policies remain eligible, but those tools don't have a proxy fallback until you activate `mcporter` again.

## 🧰 Tool input (reference)

Tool name: `mcporter`

- `action`: `"search" | "describe" | "call"`
- `selector?`: `"server.tool"` (required for `describe` and `call`)
- `query?`: free-text query for `search`
- `limit?`: result limit (default 20, max 100)
- `args?`: object arguments for `call`
- `argsJson?`: JSON-object-string fallback for `call`
- `timeoutMs?`: per-call timeout override

## ⚙️ Configuration

pi-mcporter intentionally keeps MCP server configuration in MCPorter. Put server definitions, transports, headers, environment interpolation, imports, and OAuth settings in MCPorter's config files:

- `~/.mcporter/mcporter.json` for user-wide servers
- `config/mcporter.json` in a project for repository-scoped servers
- `MCPORTER_CONFIG=/absolute/path/to/mcporter.json` when you need an explicit config file

Example MCPorter config:

```json
{
  "mcpServers": {
    "linear": {
      "baseUrl": "https://mcp.linear.app/mcp",
      "headers": {
        "Authorization": "Bearer ${LINEAR_API_KEY}"
      }
    },
    "everything": {
      "command": "npx -y @modelcontextprotocol/server-everything"
    }
  }
}
```

Configure only pi-specific exposure in these files:

- Global: `<Pi agent directory>/mcporter.json`, normally `~/.pi/agent/mcporter.json`.
- Project: `<cwd>/.pi/mcporter.json`.

Every file must set `"version": 1`. Project scalar values override global values. A project server entry replaces the complete global entry for that server; fields within an entry don't merge. Set a project server entry to `null` to remove its inherited global policy.

For example, a global file can define the defaults and common policies:

```json
{
  "version": 1,
  "defaultExposure": "index",
  "callTimeoutMs": 30000,
  "discoveryTimeoutMs": 2000,
  "maxMatchedTools": 8,
  "servers": {
    "linear": {
      "exposure": "native",
      "includeTools": ["list_*", "get_*"]
    },
    "slack": {
      "exposure": "match"
    }
  }
}
```

A project file can replace the Linear policy and remove the inherited Slack policy:

```json
{
  "version": 1,
  "maxMatchedTools": 5,
  "servers": {
    "linear": {
      "exposure": "match",
      "includeTools": ["get_*"]
    },
    "slack": null
  }
}
```

The settings are:

- `defaultExposure`: The `on-demand`, `index`, or `match` policy for servers without an override. The default is `index`; `native` isn't valid as a default.
- `callTimeoutMs`: The default MCP call timeout from 1 to 300,000 milliseconds. A proxy call's `timeoutMs` input still overrides it.
- `discoveryTimeoutMs`: The overall cold discovery budget from 100 to 30,000 milliseconds. The default is 2,000.
- `maxMatchedTools`: The maximum number of signatures in a `match` message, from 1 to 50. The default is 8.
- `servers`: Per-server exposure policies keyed by the exact MCPorter server name.

pi-mcporter re-reads both files at session start and before every agent request. Exposure changes therefore apply without reloading the extension. Native definitions that are no longer selected become inactive; Pi doesn't provide an API to unregister their retained definitions. A manual disable remains in effect while the corresponding native policy and schema stay unchanged. If refreshing a changed native definition fails, the previous definition stays active and the failure appears in `/mcporter status`.

Validation is strict. An unknown key, unsupported version, invalid bound, or malformed policy disables `index`, `match`, and `native` enrichment for that project root. The `mcporter` proxy continues to work with the default call timeout, and pi-mcporter reports each distinct configuration error once.

Run `/mcporter status` to inspect the resolved files, effective policies, cache state, discovery errors, and active native tools. The command doesn't start a cold MCP runtime.

MCP tool descriptions and schema annotations come from third parties. pi-mcporter normalizes and bounds this metadata, marks it as untrusted, and tells the model not to follow embedded instructions.

## 🪄 Output behavior

Tool output follows pi's native expand/collapse behavior:

- Collapsed view shows a compact summary
- Expanded view shows the full rendered output
- Collapsed call headers may preview tool arguments, but sensitive fields such as tokens, passwords, API keys, authorization headers, and cookies are redacted
- Use pi's `app.tools.expand` keybinding (default `Ctrl+O`) to toggle expansion

## 🧯 Troubleshooting

- **Unknown server/tool**: run `npx mcporter list` and `npx mcporter list <server>` to verify names.
- **Auth issues**: run `npx mcporter auth <server>`.
- **Slow calls**: Increase `callTimeoutMs` in a pi-mcporter configuration file or override `timeoutMs` per proxy call.
- **Missing matched or native tools**: Run `/mcporter status` to check filters, discovery progress, and schema errors.
- **Invalid exposure configuration**: Fix the reported error. Version 1 rejects unknown and legacy keys, including `mode`, `serverModes`, and top-level `timeoutMs`.
- **Config not found**: create `~/.mcporter/mcporter.json` or `config/mcporter.json`, or export `MCPORTER_CONFIG=<path>`.
- **Truncated output**: the response includes a temp file path with full output.

## 🧹 Uninstall

```sh
pi remove npm:pi-mcporter
```

## 📄 License

[MIT](LICENSE)
