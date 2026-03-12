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
import { resolveMcporterMode } from "./mode.js";
import { McporterParameters, type McporterParams } from "./parameters.js";
import { levenshtein, rankTools, scoreTool, suggest } from "./search.js";
import { withPromptMetadata } from "./tool-registration.js";
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

  pi.registerTool(
    withPromptMetadata(
      {
        name: "mcporter",
        label: "MCPorter",
        description:
          `Discover and call MCP tools through MCPorter using one stable proxy tool. ` +
          `Use action='call' directly when you already know the selector, action='describe' when you need schema details, and action='search' only to find unknown tools. ` +
          `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} and saved to a temp file when truncated.`,
        parameters: McporterParameters,

        async execute(_toolCallId, rawParams, signal, onUpdate, _ctx) {
          const params = rawParams as McporterParams;
          const activeRuntime = await controller.ensureRuntime();
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
      },
      {
        promptGuidelines: [
          "Prefer action='call' when the MCP selector is already known or obvious from context.",
          "Use action='describe' to inspect arguments or schema details before calling an unfamiliar MCP tool.",
          "Use action='search' only when the needed MCP tool is still unknown.",
        ],
      },
    ),
  );

  pi.on("session_start", async (_event, ctx) => {
    const status = await controller.warmup();

    for (const message of controller.getStartupMessages(status)) {
      if (ctx.hasUI) {
        ctx.ui.notify(message, "warning");
      } else {
        emitStderrNotice(message);
      }
    }
  });

  pi.on("before_agent_start", async () => {
    if (await controller.shouldWarmupBeforeAgentStart()) {
      await controller.warmup();
    }
  });

  pi.on("session_shutdown", async () => {
    await controller.shutdown();
  });
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

export const __test__ = {
  clampLimit,
  formatCallArgsPreview,
  levenshtein,
  parseCallArgs,
  parseSelector,
  rankTools,
  resolveCallTimeoutFromInputs,
  resolveMcporterMode,
  scoreTool,
  suggest,
};
