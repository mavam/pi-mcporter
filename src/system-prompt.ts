import { cleanSingleLine } from "./helpers.js";
import type { CatalogTool } from "./types.js";

const MAX_PRELOADED_PROMPT_TOOLS = 40;
const MAX_PRELOADED_DESCRIPTION_LENGTH = 140;

export function buildCatalogSystemPromptAppend(
  tools: CatalogTool[],
): string | undefined {
  if (tools.length === 0) {
    return undefined;
  }

  const uniqueTools = dedupeCatalogTools(tools);
  const preview = uniqueTools.slice(0, MAX_PRELOADED_PROMPT_TOOLS);
  const lines = [
    "MCPorter preloaded MCP catalog metadata for this turn.",
    "When one of these selectors clearly matches the user's request, call `mcporter` with action='call' directly. Use action='describe' for schema details and action='search' only when no warmed selector fits.",
    "Warmed MCP selectors:",
    ...preview.map(formatCatalogPromptLine),
  ];

  if (uniqueTools.length > preview.length) {
    lines.push(
      `- … ${uniqueTools.length - preview.length} more warmed selector(s) are available through mcporter.`,
    );
  }

  return lines.join("\n");
}

function dedupeCatalogTools(tools: CatalogTool[]): CatalogTool[] {
  const bySelector = new Map<string, CatalogTool>();
  for (const tool of tools) {
    bySelector.set(tool.selector, tool);
  }
  return [...bySelector.values()].sort((a, b) =>
    a.selector.localeCompare(b.selector),
  );
}

function formatCatalogPromptLine(tool: CatalogTool): string {
  const description = tool.description
    ? cleanSingleLine(tool.description).slice(
        0,
        MAX_PRELOADED_DESCRIPTION_LENGTH,
      )
    : "";
  return description
    ? `- ${tool.selector} — ${description}`
    : `- ${tool.selector}`;
}
