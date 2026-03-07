import { readFile } from "node:fs/promises";
import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  keyHint,
} from "@mariozechner/pi-coding-agent";
import {
  Text,
  truncateToWidth,
  type Component,
  visibleWidth,
} from "@mariozechner/pi-tui";
import { createRuntime, type Runtime } from "mcporter";
import { handleCallAction } from "./actions/call.js";
import { handleDescribeAction } from "./actions/describe.js";
import { handleSearchAction } from "./actions/search.js";
import { CatalogStore } from "./catalog-store.js";
import { DEFAULT_CALL_TIMEOUT_MS } from "./constants.js";
import { cleanSingleLine, textContent, toErrorMessage } from "./helpers.js";
import {
  clampLimit,
  parseCallArgs,
  parseSelector,
  resolveCallTimeoutFromInputs,
} from "./inputs.js";
import { McporterParameters, type McporterParams } from "./parameters.js";
import { levenshtein, rankTools, scoreTool, suggest } from "./search.js";
import type { ToolDetails } from "./types.js";

const PACKAGE_VERSION: string = await readFile(
  new URL("../package.json", import.meta.url),
  "utf8",
)
  .then((raw) => (JSON.parse(raw) as { version: string }).version)
  .catch(() => "0.0.0-dev");

export default function mcporterExtension(pi: ExtensionAPI) {
  let runtime: Runtime | undefined;
  let runtimePromise: Promise<Runtime> | undefined;
  const catalogStore = new CatalogStore();

  pi.registerFlag("mcporter-config", {
    description:
      "Path to mcporter.json (overrides MCPORTER_CONFIG and defaults)",
    type: "string",
  });

  pi.registerFlag("mcporter-timeout-ms", {
    description: `Default timeout for mcporter call action in milliseconds (default ${DEFAULT_CALL_TIMEOUT_MS})`,
    type: "string",
    default: String(DEFAULT_CALL_TIMEOUT_MS),
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      await ensureRuntime();
    } catch (error) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `mcporter extension: ${toErrorMessage(error)}`,
          "warning",
        );
      } else {
        emitStderrNotice(`mcporter extension: ${toErrorMessage(error)}`);
      }
    }
  });

  pi.on("session_shutdown", async () => {
    const activeRuntime = runtime;
    runtime = undefined;
    runtimePromise = undefined;
    catalogStore.clear();

    if (activeRuntime) {
      await activeRuntime.close().catch(() => {});
    }
  });

  pi.registerTool({
    name: "mcporter",
    label: "MCPorter",
    description:
      `Discover and call MCP tools through MCPorter using one stable proxy tool. ` +
      `Use action='search' to find tools, action='describe' for schema, action='call' to invoke. ` +
      `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} and saved to a temp file when truncated.`,
    parameters: McporterParameters,

    async execute(_toolCallId, rawParams, signal, onUpdate, _ctx) {
      const params = rawParams as McporterParams;
      const activeRuntime = await ensureRuntime();
      if (signal?.aborted) {
        throw new Error("Cancelled.");
      }

      switch (params.action) {
        case "search": {
          onUpdate?.({
            content: textContent("Refreshing MCP catalog…"),
            details: { action: "search" },
          });
          return await handleSearchAction(
            activeRuntime,
            params,
            signal,
            catalogStore,
          );
        }
        case "describe": {
          onUpdate?.({
            content: textContent("Loading MCP tool metadata…"),
            details: { action: "describe" },
          });
          return await handleDescribeAction(
            activeRuntime,
            params,
            signal,
            catalogStore,
          );
        }
        case "call": {
          onUpdate?.({
            content: textContent("Calling MCP tool…"),
            details: { action: "call", selector: params.selector },
          });
          return await handleCallAction(
            activeRuntime,
            params,
            signal,
            catalogStore,
            resolveCallTimeout,
          );
        }
        default:
          throw new Error(
            `Unknown action '${String(params.action)}'. Use one of: search, describe, call.`,
          );
      }
    },

    renderCall(args, theme) {
      return renderCallHeader(args as McporterParams, theme);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as ToolDetails | undefined;
      const text = extractTextContent(result.content);
      const isError = Boolean((result as { isError?: boolean }).isError);

      if (isPartial) {
        return renderSimpleText(text ?? "Working…", theme, "warning");
      }

      if (isError) {
        return renderBlockText(text ?? "mcporter failed", theme, "error");
      }

      if (!details) {
        return renderBlockText(text ?? "", theme, "toolOutput");
      }

      if (details.action !== "call") {
        if (expanded) {
          return renderBlockText(text ?? "", theme, "toolOutput");
        }
        return renderCollapsedActionSummary(details, text, theme);
      }

      if (expanded) {
        return renderBlockText(text ?? "", theme, "toolOutput");
      }

      const summary =
        details.callOutputSummary ??
        `${details.selector ?? "mcporter call"}: output available`;
      let summaryText = theme.fg("success", summary);
      summaryText += theme.fg("muted", ` (${getExpandHint()})`);
      return new Text(summaryText, 0, 0);
    },
  });

  function resolveConfiguredPath(): string | undefined {
    const explicit = pi.getFlag("mcporter-config");
    if (typeof explicit === "string" && explicit.trim().length > 0) {
      return explicit.trim();
    }
    const env = process.env.MCPORTER_CONFIG;
    if (typeof env === "string" && env.trim().length > 0) {
      return env.trim();
    }
    return undefined;
  }

  async function ensureRuntime(): Promise<Runtime> {
    if (runtime) {
      return runtime;
    }
    if (!runtimePromise) {
      const configPath = resolveConfiguredPath();
      runtimePromise = createRuntime({
        ...(configPath ? { configPath } : {}),
        clientInfo: { name: "pi-mcporter", version: PACKAGE_VERSION },
      })
        .then((created) => {
          runtime = created;
          return created;
        })
        .catch((error) => {
          runtimePromise = undefined;
          throw error;
        });
    }
    return runtimePromise;
  }

  function resolveCallTimeout(override?: number): number {
    const flagValue = pi.getFlag("mcporter-timeout-ms");
    return resolveCallTimeoutFromInputs(
      override,
      typeof flagValue === "string" ? flagValue : undefined,
    );
  }
}

function emitStderrNotice(message: string): void {
  process.stderr.write(`${message}\n`);
}

function extractTextContent(
  content: Array<{ type: string; text?: string }> | undefined,
): string | undefined {
  if (!content || content.length === 0) {
    return undefined;
  }
  const text = content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text?.trimEnd() ?? "")
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

function renderBlockText(
  text: string,
  theme: Pick<Theme, "fg">,
  color: "toolOutput" | "error",
): Text {
  if (!text) {
    return new Text("", 0, 0);
  }
  const rendered = text
    .split("\n")
    .map((line) => theme.fg(color, line))
    .join("\n");
  return new Text(`\n${rendered}`, 0, 0);
}

function renderSimpleText(
  text: string,
  theme: Pick<Theme, "fg">,
  color: "warning" | "muted" | "success",
): Text {
  return new Text(theme.fg(color, text), 0, 0);
}

function renderCollapsedActionSummary(
  details: ToolDetails,
  text: string | undefined,
  theme: Pick<Theme, "fg">,
): Text {
  const summary = getCollapsedActionSummary(details, text);
  let summaryText = theme.fg("success", summary);
  summaryText += theme.fg("muted", ` (${getExpandHint()})`);
  return new Text(summaryText, 0, 0);
}

function getCollapsedActionSummary(
  details: ToolDetails,
  text: string | undefined,
): string {
  switch (details.action) {
    case "describe":
      return `${details.selector ?? "mcporter describe"} schema available`;
    case "search":
      return getFirstLine(text) ?? "mcporter search results available";
    case "call":
      return (
        details.callOutputSummary ??
        `${details.selector ?? "mcporter call"}: output available`
      );
  }
}

function getFirstLine(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const firstLine = text.split("\n", 1)[0]?.trim();
  return firstLine && firstLine.length > 0 ? firstLine : undefined;
}

function getExpandHint(): string {
  try {
    return keyHint("expandTools", "to expand");
  } catch {
    return "to expand";
  }
}

function renderCallHeader(params: McporterParams, theme: Theme): Component {
  return {
    invalidate() {},
    render(width) {
      let header = theme.fg("toolTitle", theme.bold("mcporter"));
      header += ` ${theme.fg("accent", params.action)}`;

      if (
        (params.action === "describe" || params.action === "call") &&
        typeof params.selector === "string" &&
        params.selector.trim().length > 0
      ) {
        header += ` ${theme.fg("muted", params.selector.trim())}`;
      } else if (
        params.action === "search" &&
        typeof params.query === "string" &&
        params.query.trim().length > 0
      ) {
        header += ` ${theme.fg("muted", `"${cleanSingleLine(params.query).slice(0, 80)}"`)}`;
      }

      const lines: string[] = [];
      const headerLine = truncateToWidth(header, width);
      lines.push(
        headerLine + " ".repeat(Math.max(0, width - visibleWidth(headerLine))),
      );

      if (params.action === "call") {
        const previewWidth = Math.max(0, width - 2);
        const callArgsPreview = formatCallArgsPreview(params, previewWidth);
        if (callArgsPreview) {
          const previewLine = truncateToWidth(
            `  ${theme.fg("muted", callArgsPreview)}`,
            width,
          );
          lines.push(
            previewLine +
              " ".repeat(Math.max(0, width - visibleWidth(previewLine))),
          );
        }
      }

      return lines;
    },
  };
}

function isBarePreviewToken(value: string): boolean {
  return /^[A-Za-z0-9._:/@-]+$/.test(value);
}

function truncateWithEllipsis(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}...`;
}

function stringifyPreviewJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "bigint") {
        return null;
      }
      if (typeof currentValue === "number" && !Number.isFinite(currentValue)) {
        return null;
      }
      if (
        currentValue === undefined ||
        typeof currentValue === "function" ||
        typeof currentValue === "symbol"
      ) {
        return null;
      }
      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }
        seen.add(currentValue);
      }
      return currentValue;
    });
    return json ?? "null";
  } catch {
    return "null";
  }
}

function formatPreviewString(value: string, maxChars: number): string {
  if (value.length > 0 && isBarePreviewToken(value)) {
    return truncateWithEllipsis(value, maxChars);
  }
  return formatJsonValuePreview(value, maxChars);
}

function formatPreviewKey(key: string, maxChars: number): string {
  if (key.length > 0 && isBarePreviewToken(key)) {
    return truncateWithEllipsis(key, maxChars);
  }
  return formatJsonValuePreview(key, maxChars);
}

function formatPreviewValue(value: unknown, maxChars: number): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
      return formatPreviewString(value, maxChars);
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      return "null";
    case "object":
      return formatJsonValuePreview(value, maxChars);
    default:
      return "null";
  }
}

function formatJsonValuePreview(value: unknown, maxChars: number): string {
  return truncateWithEllipsis(stringifyPreviewJson(value), maxChars);
}

function formatArgsObjectKeyValuePreview(
  value: Record<string, unknown>,
  maxChars: number,
): string | undefined {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return undefined;
  }

  const preview = entries
    .map(
      ([key, entryValue]) =>
        `${formatPreviewKey(key, maxChars)}=${formatPreviewValue(entryValue, maxChars)}`,
    )
    .join(" ");

  return preview.length > 0
    ? truncateWithEllipsis(preview, maxChars)
    : undefined;
}

function formatCallArgsPreview(
  params: McporterParams,
  maxChars: number,
): string | undefined {
  if (maxChars <= 0) {
    return undefined;
  }

  const argsResult = parseCallArgs(params);
  if ("error" in argsResult || Object.keys(argsResult.args).length === 0) {
    return undefined;
  }

  try {
    return formatArgsObjectKeyValuePreview(argsResult.args, maxChars);
  } catch {
    return undefined;
  }
}

export const __test__ = {
  clampLimit,
  formatCallArgsPreview,
  levenshtein,
  parseCallArgs,
  parseSelector,
  rankTools,
  resolveCallTimeoutFromInputs,
  scoreTool,
  suggest,
};
