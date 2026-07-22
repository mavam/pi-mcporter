import type { Runtime } from "mcporter";
import type { CatalogStore } from "../catalog-store.js";
import { DEFAULT_SEARCH_LIMIT } from "../constants.js";
import { cleanSingleLine, raceAbort, textContent } from "../helpers.js";
import { clampLimit } from "../inputs.js";
import { shapeOutput } from "../output.js";
import type { McporterParams } from "../parameters.js";
import { rankServers, rankTools } from "../search.js";
import type { ToolDetails } from "../types.js";

export async function handleSearchAction(
  activeRuntime: Runtime,
  params: McporterParams,
  signal: AbortSignal | undefined,
  catalogStore: CatalogStore,
) {
  const catalog = await raceAbort(
    catalogStore.getBasicCatalog(activeRuntime),
    signal,
  );

  const limit = clampLimit(params.limit ?? DEFAULT_SEARCH_LIMIT);
  const query = params.query?.trim() ?? "";
  const serverMatches = query
    ? rankServers(catalog.servers, query).slice(0, limit)
    : [];
  const toolMatches = rankTools(catalog.tools, query).slice(
    0,
    Math.max(0, limit - serverMatches.length),
  );

  const lines: string[] = [];
  const serverCount = catalog.servers.length;
  if (query) {
    lines.push(
      `Found ${formatCount(serverMatches.length, "server match", "server matches")} and ${formatCount(toolMatches.length, "tool match", "tool matches")} for '${cleanSingleLine(query)}' across ${formatCount(serverCount, "known MCP server")}.`,
    );
  } else {
    lines.push(
      `Showing ${formatCount(toolMatches.length, "tool")} across ${formatCount(serverCount, "known MCP server")}.`,
    );
  }

  if (serverMatches.length > 0) {
    lines.push("", "Servers:");
    for (const server of serverMatches) {
      const error = catalog.serverErrors.get(server);
      const toolCount = catalog.byServer.get(server)?.length ?? 0;
      const status = error
        ? `known MCP server; tool metadata unavailable (${classifyServerError(error)})`
        : `${formatCount(toolCount, "tool")} available`;
      lines.push(`- \`${formatMarkdownCodeSpan(server)}\` — ${status}`);
    }
  }

  if (toolMatches.length > 0) {
    lines.push("", "Tools:");
    for (const match of toolMatches) {
      const desc = cleanSingleLine(match.description ?? "");
      lines.push(
        desc
          ? `- \`${formatMarkdownCodeSpan(match.selector)}\`: ${desc}`
          : `- \`${formatMarkdownCodeSpan(match.selector)}\``,
      );
    }
  }

  if (serverMatches.length === 0 && toolMatches.length === 0) {
    lines.push("", "No MCP servers or tools matched.");
    if (catalog.servers.length > 0) {
      lines.push(
        `Known servers: ${catalog.servers.map((server) => `\`${formatMarkdownCodeSpan(server)}\``).join(", ")}.`,
        "Try a known server name or fewer capability terms.",
      );
    }
  }

  const unavailableMatches = serverMatches.filter((server) =>
    catalog.serverErrors.has(server),
  );
  lines.push("");
  if (toolMatches.length > 0) {
    lines.push(
      "Next step: choose a `server.tool` selector, then use `action='describe'` before `action='call'`.",
    );
  } else if (serverMatches.length > 0) {
    lines.push(
      "A server name is a discovery result, not a callable selector. Search by capability to find a `server.tool` selector.",
    );
  } else {
    lines.push(
      "Search accepts a server name (for example `linear`) or a capability phrase (for example `create issue`).",
    );
  }

  if (unavailableMatches.length > 0) {
    lines.push(...recoveryHints(unavailableMatches, catalog.serverErrors));
  }

  if (catalog.warnings.length > 0) {
    lines.push(
      `Tool metadata is unavailable for ${formatCount(catalog.warnings.length, "known server")} due to authentication, connectivity, or discovery errors.`,
    );
  }

  const shaped = await shapeOutput(lines.join("\n"));
  return {
    content: textContent(shaped.text),
    details: {
      action: "search",
      resultCount: serverMatches.length + toolMatches.length,
      serverResultCount: serverMatches.length,
      toolResultCount: toolMatches.length,
      cacheAgeMs: Date.now() - catalog.fetchedAt,
      warnings: catalog.warnings,
      truncation: shaped.truncation,
      fullOutputPath: shaped.fullOutputPath,
    } satisfies ToolDetails,
  };
}

function formatCount(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function classifyServerError(error: string): string {
  const normalized = error.toLowerCase();
  if (
    /\b(401|403|auth\w*|login|oauth\w*|unauthorized|forbidden)\b/.test(
      normalized,
    )
  ) {
    return "authentication required";
  }
  if (
    /\b(econn[a-z]*|connect\w*|network|offline|socket|unreachable|refused|timeout|timed out|fetch failed)\b/.test(
      normalized,
    )
  ) {
    return "offline or unreachable";
  }
  return "discovery error";
}

function recoveryHints(
  servers: string[],
  errors: Map<string, string>,
): string[] {
  const authServers = servers.filter(
    (server) =>
      classifyServerError(errors.get(server) ?? "") ===
      "authentication required",
  );
  const offlineServers = servers.filter(
    (server) =>
      classifyServerError(errors.get(server) ?? "") ===
      "offline or unreachable",
  );
  const otherServers = servers.filter(
    (server) =>
      classifyServerError(errors.get(server) ?? "") === "discovery error",
  );
  const lines: string[] = [];

  for (const server of authServers) {
    lines.push(
      `Recovery: authenticate \`${formatMarkdownCodeSpan(server)}\` outside this tool with \`mcporter auth <server>\`, then retry search.`,
    );
  }
  if (offlineServers.length > 0) {
    lines.push(
      `Recovery: restore connectivity for ${formatServerList(offlineServers)}, then retry search.`,
    );
  }
  if (otherServers.length > 0) {
    lines.push(
      `Recovery: check the MCPorter configuration and logs for ${formatServerList(otherServers)}, then retry search.`,
    );
  }

  return lines;
}

function formatServerList(servers: string[]): string {
  return servers
    .map((server) => `\`${formatMarkdownCodeSpan(server)}\``)
    .join(", ");
}

function formatMarkdownCodeSpan(value: string): string {
  return value.replaceAll("`", "\\`");
}
