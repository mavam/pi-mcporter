# 🧳 pi-mcporter

Use MCP tools from [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) through one stable tool (`mcporter`), powered by [MCPorter](https://github.com/steipete/mcporter).

## 🧠 Philosophy: CLI > MCP

- **pi is fundamentally CLI-first.**
- Prefer native CLIs whenever available (`gh`, `git`, `kubectl`, `aws`, etc.).
- Use MCP via `mcporter` when it adds clear value (for example: Linear, Slack, hosted auth-heavy integrations, cross-tool workflows).
- This package is intentionally a **thin bridge**, not a replacement for pi’s normal tool-driven workflow.

## ✨ Why use this package

- Keeps context small: one stable `mcporter` tool instead of exposing many MCP tools
- Uses your MCPorter config/runtime as source of truth
- Supports discovery (`search`), schema help (`describe`), and execution (`call`)
- Returns useful error hints for auth/offline/http/stdio failures

## 📋 Prerequisites

You need [MCPorter](https://github.com/steipete/mcporter) installed and configured with at least one MCP server:

```bash
npm install -g mcporter
npx mcporter list          # verify your servers are visible
```

## 📦 Install

Install as a pi package:

```bash
pi install npm:pi-mcporter
```

Try it once without installing:

```bash
pi -e npm:pi-mcporter
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

3. Ask for what you need — pi picks the right MCP tools automatically:

- `What are my open Linear issues this sprint?`
- `Catch me up on #engineering in Slack from today.`
- `Find the onboarding runbook in Notion and summarize the setup steps.`

## 🔍 The three actions

The `mcporter` tool has three actions that map to a natural discovery → execution workflow.

### `search` — find tools by keyword

Use when you don't know the exact server or tool name.

```json
{ "action": "search", "query": "linear issue", "limit": 5 }
```

Returns matching selectors with short descriptions:

```
linear.create_issue — Create a new issue in a Linear team
linear.list_issues  — List issues matching a filter
```

### `describe` — get the full schema for a tool

Use when you know the selector but need to see its required parameters before calling.

```json
{ "action": "describe", "selector": "linear.create_issue" }
```

Returns the full JSON Schema for the tool's input, including required vs. optional fields and their types.

### `call` — invoke a tool

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

In practice pi follows this pattern automatically. With `mode: "preload"` the catalog is already warm at agent start, so pi can often skip `search`/`describe` and jump straight to `call`.

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

Configure the extension in `~/.pi/agent/mcporter.json`:

```json
{
  "configPath": "/absolute/path/to/mcporter.json",
  "timeoutMs": 30000,
  "mode": "lazy"
}
```

- `MCPORTER_CONFIG=/absolute/path/to/mcporter.json` still overrides `configPath` from the settings file.
- `configPath`: optional explicit MCPorter config path. If omitted, MCPorter uses its normal default resolution.
- `timeoutMs`: optional default call timeout in milliseconds. Tool-level `timeoutMs` still overrides this per call.
- `mode`: optional default MCP tool visibility mode.
  - `lazy`: only the stable `mcporter` proxy tool is visible and MCP metadata loads on demand
  - `preload`: still only exposes `mcporter`, but preloads MCP tool metadata before agent start so the agent can skip unnecessary discovery more often

Legacy extension flags `--mcporter-config` and `--mcporter-timeout-ms` are no longer supported. Use `~/.pi/agent/mcporter.json`, `MCPORTER_CONFIG`, and per-call `timeoutMs` instead.

## 🪄 Output behavior

Tool output follows pi's native expand/collapse behavior:

- Collapsed view shows a compact summary
- Expanded view shows the full rendered output
- Collapsed call headers may preview tool arguments, but sensitive fields such as tokens, passwords, API keys, authorization headers, and cookies are redacted
- Use pi's `app.tools.expand` keybinding (default `Ctrl+O`) to toggle expansion

## 🧯 Troubleshooting

- **Unknown server/tool**: run `npx mcporter list` and `npx mcporter list <server>` to verify names.
- **Auth issues**: run `npx mcporter auth <server>`.
- **Slow calls**: increase `timeoutMs` in `~/.pi/agent/mcporter.json` or override `timeoutMs` per tool call.
- **Config not found**: set `configPath` in `~/.pi/agent/mcporter.json` or export `MCPORTER_CONFIG=<path>`.
- **Truncated output**: the response includes a temp file path with full output.

## 📄 License

[MIT](LICENSE)
