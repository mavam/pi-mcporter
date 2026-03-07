import type { Runtime } from "mcporter";
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
} from "./constants.js";
import { isPlainObject, toErrorMessage } from "./helpers.js";
import type { McporterParams } from "./parameters.js";
import { suggest } from "./search.js";
import type { CatalogTool, ParsedSelector } from "./types.js";

export function parseSelector(
  selector: string | undefined,
): ParsedSelector | { error: string } {
  if (!selector || selector.trim().length === 0) {
    return {
      error: "selector is required and must use the form 'server.tool'.",
    };
  }

  const raw = selector.trim();
  const split = raw.lastIndexOf(".");
  if (split <= 0 || split === raw.length - 1) {
    return {
      error: `Invalid selector '${raw}'. Expected 'server.tool' (e.g. 'linear.list_issues').`,
    };
  }

  const server = raw.slice(0, split).trim();
  const tool = raw.slice(split + 1).trim();

  if (!server || !tool) {
    return {
      error: `Invalid selector '${raw}'. Expected 'server.tool' (e.g. 'linear.list_issues').`,
    };
  }

  return { raw, server, tool };
}

export function validateServer(
  activeRuntime: Runtime,
  server: string,
): string | undefined {
  const knownServers = activeRuntime.listServers();
  if (knownServers.includes(server)) {
    return undefined;
  }

  const suggestions = suggest(server, knownServers);
  if (suggestions.length > 0) {
    return `Unknown MCP server '${server}'. Did you mean: ${suggestions.join(", ")}?`;
  }

  return `Unknown MCP server '${server}'. Available servers: ${knownServers.join(", ") || "(none)"}.`;
}

export function findToolByName(
  tools: CatalogTool[],
  name: string,
): CatalogTool | undefined {
  return (
    tools.find((tool) => tool.tool === name) ??
    tools.find((tool) => tool.tool.toLowerCase() === name.toLowerCase())
  );
}

export function formatUnknownTool(
  selector: ParsedSelector,
  knownTools: CatalogTool[],
): string {
  const names = knownTools.map((tool) => tool.tool);
  const suggestions = suggest(selector.tool, names).map(
    (name) => `${selector.server}.${name}`,
  );
  if (suggestions.length > 0) {
    return `Unknown MCP tool '${selector.raw}'. Did you mean: ${suggestions.join(", ")}?`;
  }
  return `Unknown MCP tool '${selector.raw}'.`;
}

export function parseCallArgs(
  params: McporterParams,
): { args: Record<string, unknown> } | { error: string } {
  const hasArgs = params.args !== undefined;
  const hasArgsJson =
    typeof params.argsJson === "string" && params.argsJson.trim().length > 0;

  if (hasArgs && hasArgsJson) {
    return { error: "Provide either args or argsJson, not both." };
  }

  if (hasArgsJson) {
    try {
      const decoded = JSON.parse(params.argsJson as string);
      if (!isPlainObject(decoded)) {
        return { error: "argsJson must decode to a JSON object." };
      }
      return { args: decoded };
    } catch (error) {
      return { error: `Failed to parse argsJson: ${toErrorMessage(error)}` };
    }
  }

  if (hasArgs) {
    if (!isPlainObject(params.args)) {
      return { error: "args must be an object when provided." };
    }
    return { args: params.args };
  }

  return { args: {} };
}

export function resolveCallTimeoutFromInputs(
  override?: number,
  flagValue?: string,
): number {
  if (
    typeof override === "number" &&
    Number.isFinite(override) &&
    override > 0
  ) {
    return Math.floor(override);
  }

  if (typeof flagValue === "string") {
    const parsed = Number.parseInt(flagValue.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_CALL_TIMEOUT_MS;
}

export function clampLimit(limit: number): number {
  const normalized = Number.isFinite(limit)
    ? Math.floor(limit)
    : DEFAULT_SEARCH_LIMIT;
  if (normalized < 1) return 1;
  if (normalized > MAX_SEARCH_LIMIT) return MAX_SEARCH_LIMIT;
  return normalized;
}
