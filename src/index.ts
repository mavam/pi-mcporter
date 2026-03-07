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

function formatPreviewString(value: string, maxChars: number): string {
  if (value.length > 0 && isBarePreviewToken(value)) {
    if (value.length <= maxChars) {
      return value;
    }
    return `${value.slice(0, maxChars)}...`;
  }
  return formatJsonValuePreview(value, maxChars);
}

function formatPreviewKey(key: string, maxChars: number): string {
  if (key.length > 0 && isBarePreviewToken(key)) {
    if (key.length <= maxChars) {
      return key;
    }
    return `${key.slice(0, maxChars)}...`;
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

function appendEscapedJsonString(
  value: string,
  parts: string[],
  output: { length: number; truncated: boolean },
  maxChars: number,
): void {
  if (output.truncated) {
    return;
  }

  appendPreviewText('"', parts, output, maxChars);
  for (const char of value) {
    if (output.truncated) {
      break;
    }

    switch (char) {
      case '"':
        appendPreviewText('\\"', parts, output, maxChars);
        break;
      case "\\":
        appendPreviewText("\\\\", parts, output, maxChars);
        break;
      case "\b":
        appendPreviewText("\\b", parts, output, maxChars);
        break;
      case "\f":
        appendPreviewText("\\f", parts, output, maxChars);
        break;
      case "\n":
        appendPreviewText("\\n", parts, output, maxChars);
        break;
      case "\r":
        appendPreviewText("\\r", parts, output, maxChars);
        break;
      case "\t":
        appendPreviewText("\\t", parts, output, maxChars);
        break;
      default:
        if (char < " ") {
          appendPreviewText(
            `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
            parts,
            output,
            maxChars,
          );
        } else {
          appendPreviewText(char, parts, output, maxChars);
        }
        break;
    }
  }
  appendPreviewText('"', parts, output, maxChars);
}

function appendJsonValuePreview(
  value: unknown,
  parts: string[],
  output: { length: number; truncated: boolean },
  maxChars: number,
): void {
  if (output.truncated) {
    return;
  }

  if (value === null) {
    appendPreviewText("null", parts, output, maxChars);
    return;
  }

  switch (typeof value) {
    case "string":
      appendEscapedJsonString(value, parts, output, maxChars);
      return;
    case "number":
      appendPreviewText(
        Number.isFinite(value) ? String(value) : "null",
        parts,
        output,
        maxChars,
      );
      return;
    case "boolean":
      appendPreviewText(value ? "true" : "false", parts, output, maxChars);
      return;
    case "bigint":
      appendPreviewText("null", parts, output, maxChars);
      return;
    case "object":
      if (Array.isArray(value)) {
        appendPreviewText("[", parts, output, maxChars);
        for (let index = 0; index < value.length; index += 1) {
          if (index > 0) {
            appendPreviewText(",", parts, output, maxChars);
          }
          appendJsonValuePreview(value[index], parts, output, maxChars);
          if (output.truncated) {
            break;
          }
        }
        appendPreviewText("]", parts, output, maxChars);
        return;
      }

      appendPreviewText("{", parts, output, maxChars);
      const entries = Object.entries(value as Record<string, unknown>);
      for (let index = 0; index < entries.length; index += 1) {
        const [key, entryValue] = entries[index];
        if (index > 0) {
          appendPreviewText(",", parts, output, maxChars);
        }
        appendEscapedJsonString(key, parts, output, maxChars);
        appendPreviewText(":", parts, output, maxChars);
        appendJsonValuePreview(entryValue, parts, output, maxChars);
        if (output.truncated) {
          break;
        }
      }
      appendPreviewText("}", parts, output, maxChars);
      return;
    default:
      appendPreviewText("null", parts, output, maxChars);
  }
}

function appendPreviewText(
  text: string,
  parts: string[],
  output: { length: number; truncated: boolean },
  maxChars: number,
): void {
  if (output.truncated || text.length === 0) {
    return;
  }

  const remaining = maxChars + 1 - output.length;
  if (remaining <= 0) {
    output.truncated = true;
    return;
  }

  if (text.length > remaining) {
    parts.push(text.slice(0, remaining));
    output.length += remaining;
    output.truncated = true;
    return;
  }

  parts.push(text);
  output.length += text.length;
}

function formatJsonValuePreview(value: unknown, maxChars: number): string {
  const parts: string[] = [];
  const output = { length: 0, truncated: false };
  appendJsonValuePreview(value, parts, output, maxChars);
  const preview = parts.join("");
  if (preview.length === 0) {
    return preview;
  }
  if (output.truncated || preview.length > maxChars) {
    return `${preview.slice(0, maxChars)}...`;
  }
  return preview;
}

function formatArgsObjectKeyValuePreview(
  value: Record<string, unknown>,
  maxChars: number,
): string | undefined {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return undefined;
  }

  const parts: string[] = [];
  const output = { length: 0, truncated: false };
  for (let index = 0; index < entries.length; index += 1) {
    const [key, entryValue] = entries[index];
    if (index > 0) {
      appendPreviewText(" ", parts, output, maxChars);
    }
    appendPreviewText(formatPreviewKey(key, maxChars), parts, output, maxChars);
    appendPreviewText("=", parts, output, maxChars);
    appendPreviewText(
      formatPreviewValue(entryValue, maxChars),
      parts,
      output,
      maxChars,
    );
    if (output.truncated) {
      break;
    }
  }

  const preview = parts.join("");
  if (preview.length === 0) {
    return undefined;
  }
  if (output.truncated || preview.length > maxChars) {
    return `${preview.slice(0, maxChars)}...`;
  }
  return preview;
}

function formatCompactJsonContainerPreview(
  raw: string,
  maxChars: number,
): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
    return undefined;
  }

  const parts: string[] = [];
  let inString = false;
  let escaping = false;
  let length = 0;
  let truncated = false;

  for (const char of trimmed) {
    if (!inString && /\s/.test(char)) {
      continue;
    }

    const remaining = maxChars + 1 - length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    if (remaining < 1) {
      truncated = true;
      break;
    }

    parts.push(char);
    length += 1;

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    }
  }

  const preview = parts.join("");
  if (preview === "{}") {
    return undefined;
  }
  if (truncated || preview.length > maxChars) {
    return `${preview.slice(0, maxChars)}...`;
  }
  return preview;
}

function formatArgsJsonPreview(
  raw: string,
  maxChars: number,
): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || !trimmed.startsWith("{")) {
    return undefined;
  }

  const preview = formatCompactJsonContainerPreview(trimmed, maxChars);
  if (preview === "{}") {
    return undefined;
  }
  return preview;
}

function skipJsonWhitespace(raw: string, start: number): number {
  let index = start;
  while (index < raw.length && /\s/.test(raw[index] ?? "")) {
    index += 1;
  }
  return index;
}

function scanJsonString(raw: string, start: number): number | undefined {
  if (raw[start] !== '"') {
    return undefined;
  }

  let index = start + 1;
  let escaping = false;
  while (index < raw.length) {
    const char = raw[index];
    if (escaping) {
      escaping = false;
    } else if (char === "\\") {
      escaping = true;
    } else if (char === '"') {
      return index + 1;
    }
    index += 1;
  }
  return undefined;
}

function scanJsonValue(raw: string, start: number): number | undefined {
  let index = start;
  let objectDepth = 0;
  let arrayDepth = 0;
  let inString = false;
  let escaping = false;

  while (index < raw.length) {
    const char = raw[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      index += 1;
      continue;
    }
    if (char === "{") {
      objectDepth += 1;
      index += 1;
      continue;
    }
    if (char === "}") {
      if (objectDepth === 0 && arrayDepth === 0) {
        return index;
      }
      objectDepth -= 1;
      index += 1;
      continue;
    }
    if (char === "[") {
      arrayDepth += 1;
      index += 1;
      continue;
    }
    if (char === "]") {
      arrayDepth -= 1;
      index += 1;
      continue;
    }
    if (char === "," && objectDepth === 0 && arrayDepth === 0) {
      return index;
    }
    index += 1;
  }

  return index;
}

function formatRawJsonValuePreview(rawValue: string, maxChars: number): string {
  if (rawValue.startsWith('"')) {
    try {
      return formatPreviewString(JSON.parse(rawValue) as string, maxChars);
    } catch {
      return formatCompactJsonContainerPreview(rawValue, maxChars) ?? rawValue;
    }
  }

  return formatCompactJsonContainerPreview(rawValue, maxChars) ?? rawValue;
}

function formatArgsJsonKeyValuePreview(
  raw: string,
  maxChars: number,
): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed === "{}" || !trimmed.startsWith("{")) {
    return undefined;
  }

  const parts: string[] = [];
  const output = { length: 0, truncated: false };
  let index = skipJsonWhitespace(trimmed, 1);
  let pairCount = 0;

  while (index < trimmed.length && trimmed[index] !== "}") {
    const keyEnd = scanJsonString(trimmed, index);
    if (keyEnd === undefined) {
      return undefined;
    }

    const rawKey = trimmed.slice(index, keyEnd);
    let key: string;
    try {
      key = JSON.parse(rawKey) as string;
    } catch {
      return undefined;
    }

    index = skipJsonWhitespace(trimmed, keyEnd);
    if (trimmed[index] !== ":") {
      return undefined;
    }

    index = skipJsonWhitespace(trimmed, index + 1);
    const valueEnd = scanJsonValue(trimmed, index);
    if (valueEnd === undefined) {
      return undefined;
    }

    if (pairCount > 0) {
      appendPreviewText(" ", parts, output, maxChars);
    }
    appendPreviewText(formatPreviewKey(key, maxChars), parts, output, maxChars);
    appendPreviewText("=", parts, output, maxChars);
    appendPreviewText(
      formatRawJsonValuePreview(
        trimmed.slice(index, valueEnd).trim(),
        maxChars,
      ),
      parts,
      output,
      maxChars,
    );
    pairCount += 1;
    if (output.truncated) {
      break;
    }

    index = skipJsonWhitespace(trimmed, valueEnd);
    if (trimmed[index] === ",") {
      index = skipJsonWhitespace(trimmed, index + 1);
      continue;
    }
    if (trimmed[index] === "}") {
      break;
    }
    return undefined;
  }

  const preview = parts.join("");
  if (preview.length === 0) {
    return undefined;
  }
  if (output.truncated || preview.length > maxChars) {
    return `${preview.slice(0, maxChars)}...`;
  }
  return preview;
}

function formatCallArgsPreview(
  params: McporterParams,
  maxChars: number,
): string | undefined {
  if (maxChars <= 0) {
    return undefined;
  }

  const hasArgs = params.args !== undefined;
  const hasArgsJson =
    typeof params.argsJson === "string" && params.argsJson.trim().length > 0;

  if (hasArgs && hasArgsJson) {
    return undefined;
  }

  if (hasArgsJson) {
    return (
      formatArgsJsonKeyValuePreview(params.argsJson as string, maxChars) ??
      formatArgsJsonPreview(params.argsJson as string, maxChars)
    );
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
