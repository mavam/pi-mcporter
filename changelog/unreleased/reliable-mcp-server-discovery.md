---
title: Reliable MCP server discovery
type: bugfix
authors:
  - mavam
  - codex
prs:
  - 12
created: 2026-07-22T20:24:47.789998Z
---

The `mcporter` search action now finds known MCP server names as well as matching tools, including when authentication or connectivity prevents the server's tool metadata from loading. Natural-language capability queries also ignore common model-oriented filler:

```json
{ "action": "search", "query": "find a tool for creating Linear issues" }
```

Search results distinguish server names from callable `server.tool` selectors and provide recovery guidance for unavailable servers.
