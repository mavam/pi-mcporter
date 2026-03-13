This release adds configurable MCP tool loading modes for Pi MCPorter while keeping the stable mcporter proxy workflow. You can choose lazy loading or preload mode to warm MCP metadata before agent startup, and startup now recovers cleanly from malformed settings, missing configuration, slow servers, and temporary MCP outages.

## 🚀 Features

### Configurable MCP tool loading modes

Pi MCPorter now lets you choose between lazy loading and catalog preloading for MCP tools, while still routing all MCP access through the stable `mcporter` interface. In preload mode, pi warms MCP tool metadata before the agent starts so it can more often skip discovery and call the right tool directly.

Malformed settings, missing configuration, slow servers, and unavailable MCP servers no longer abort agent startup. Preloading now retries after transient failures and refreshes cached catalog data after it expires.

Configuration now comes from `~/.pi/agent/mcporter.json`, `MCPORTER_CONFIG`, and per-call `timeoutMs`. The legacy `--mcporter-config` and `--mcporter-timeout-ms` extension flags are no longer supported.

*By @mavam and @codex in #3.*
