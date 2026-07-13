import { readFile } from "node:fs/promises";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  getMarkdownTheme,
  keyText,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Markdown,
  Text,
  TruncatedText,
  type Component,
} from "@earendil-works/pi-tui";
import { handleCallAction } from "./actions/call.js";
import { handleDescribeAction } from "./actions/describe.js";
import { handleSearchAction } from "./actions/search.js";
import { createMcporterController } from "./bootstrap.js";
import { formatCallArgsPreview } from "./call-args-preview.js";
import { cleanSingleLine, textContent } from "./helpers.js";
import {
  clampLimit,
  parseCallArgs,
  parseSelector,
  resolveCallTimeoutFromInputs,
} from "./inputs.js";
import { resolveMcporterMode, resolveServerMode } from "./mode.js";
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
  const controller = createMcporterController(pi, {
    packageVersion: PACKAGE_VERSION,
  });

  pi.registerTool({
    name: "mcporter",
    label: "MCPorter",
    description:
      `Discover and call MCP tools through MCPorter using one stable proxy tool. ` +
      `Use action='call' directly when you already know the selector, action='describe' when you need schema details, and action='search' only to find unknown tools. ` +
      `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} and saved to a temp file when truncated.`,
    parameters: McporterParameters,

    async execute(_toolCallId, rawParams, signal, onUpdate, ctx) {
      const params = rawParams as McporterParams;
      const activeRuntime = await controller.ensureRuntime(ctx.cwd);
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
            controller.catalogStore,
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
            controller.catalogStore,
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
            controller.catalogStore,
            controller.resolveCallTimeout,
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

    renderResult(result, { expanded, isPartial }, theme, context) {
      const details = result.details as ToolDetails | undefined;
      const text = extractTextContent(result.content);
      const isError = Boolean(context?.isError);

      if (isPartial) {
        return renderSimpleText(text ?? "Working…", theme, "warning");
      }

      if (isError) {
        return renderBlockText(text ?? "mcporter failed", theme, "error");
      }

      if (!details) {
        return renderBlockText(text ?? "", theme, "toolOutput");
      }

      if (expanded) {
        return renderBlockText(text ?? "", theme, "toolOutput");
      }

      return renderCollapsedResult(details, text, theme);
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!isToolActive(pi, "mcporter")) {
      return;
    }

    const systemPromptAppend = await controller.buildSystemPromptAppend(
      ctx.cwd,
    );
    if (systemPromptAppend) {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${systemPromptAppend}`,
      };
    }
  });

  pi.on("session_shutdown", async () => {
    await controller.shutdown();
  });
}

function isToolActive(
  pi: Pick<ExtensionAPI, "getActiveTools">,
  toolName: string,
): boolean {
  try {
    return pi.getActiveTools().includes(toolName);
  } catch {
    return true;
  }
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
): Component {
  if (!text) {
    return new Text("", 0, 0);
  }

  if (color === "toolOutput") {
    return new Markdown(`\n${text}`, 0, 0, getMarkdownTheme());
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

function renderCollapsedResult(
  details: ToolDetails,
  text: string | undefined,
  theme: Theme,
): Component {
  const summary =
    details.action === "search"
      ? (getFirstLine(text) ?? getCollapsedActionSummary(details))
      : getCollapsedActionSummary(details);
  return new Text(withExpandHint(theme.fg("success", summary), theme), 0, 0);
}

function getCollapsedActionSummary(details: ToolDetails): string {
  switch (details.action) {
    case "describe":
      return `${details.selector ?? "mcporter describe"} schema available`;
    case "search":
      return "mcporter search results available";
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

function withExpandHint(text: string, theme: Pick<Theme, "fg">): string {
  return `${text} (${formatExpandHint(theme)})`;
}

function formatExpandHint(theme: Pick<Theme, "fg">): string {
  let key = "";
  try {
    key = keyText("app.tools.expand").trim();
  } catch {
    key = "";
  }

  return `${theme.fg("dim", key || "ctrl+o")}${theme.fg("muted", " to expand")}`;
}

function renderCallHeader(params: McporterParams, theme: Theme): Component {
  return new McporterCallHeader(params, theme);
}

class McporterCallHeader extends Container {
  constructor(
    private readonly params: McporterParams,
    private readonly theme: Theme,
  ) {
    super();
  }

  override render(width: number): string[] {
    const container = new Container();
    container.addChild(
      new TruncatedText(formatCallTitle(this.params, this.theme), 0, 0),
    );

    if (this.params.action === "call") {
      const preview = formatCallArgsPreview(
        this.params,
        Math.max(0, width - 2),
      );
      if (preview) {
        container.addChild(
          new TruncatedText(`  ${this.theme.fg("muted", preview)}`, 0, 0),
        );
      }
    }

    return container.render(width);
  }
}

function formatCallTitle(params: McporterParams, theme: Theme): string {
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

  return header;
}

export const __test__ = {
  clampLimit,
  formatCallArgsPreview,
  levenshtein,
  parseCallArgs,
  parseSelector,
  rankTools,
  resolveCallTimeoutFromInputs,
  resolveMcporterMode,
  resolveServerMode,
  scoreTool,
  suggest,
};
