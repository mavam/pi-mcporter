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
import { formatCallArgsPreview } from "./call-args-preview.js";
import { CatalogStore } from "./catalog-store.js";
import { cleanSingleLine, textContent, toErrorMessage } from "./helpers.js";
import { registerHoistedTools } from "./hoisted-tools.js";
import {
  clampLimit,
  parseCallArgs,
  parseSelector,
  resolveCallTimeoutFromInputs,
} from "./inputs.js";
import {
  resolveMcporterMode,
  shouldHoistTools,
  shouldPreloadCatalog,
} from "./mode.js";
import { McporterParameters, type McporterParams } from "./parameters.js";
import { levenshtein, rankTools, scoreTool, suggest } from "./search.js";
import { preloadCatalogForMode } from "./startup.js";
import {
  getDefaultMcporterSettings,
  loadMcporterSettings,
  type McporterSettings,
} from "./settings.js";
import { withPromptMetadata } from "./tool-registration.js";
import type { ToolDetails } from "./types.js";

const PACKAGE_VERSION: string = await readFile(
  new URL("../package.json", import.meta.url),
  "utf8",
)
  .then((raw) => (JSON.parse(raw) as { version: string }).version)
  .catch(() => "0.0.0-dev");

export default async function mcporterExtension(pi: ExtensionAPI) {
  let runtime: Runtime | undefined;
  let runtimePromise: Promise<Runtime> | undefined;
  let preloadPromise: Promise<void> | undefined;
  let preloadWarnings: string[] = [];
  let preloadError: string | undefined;
  let settings = getDefaultMcporterSettings();
  let settingsPromise: Promise<McporterSettings> | undefined;
  const catalogStore = new CatalogStore();
  const registeredHoistedSelectors = new Map<string, string>();
  const registeredHoistedNames = new Set<string>();
  let activeHoistedToolNames = new Set<string>();

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
    try {
      const activeRuntime = await ensureRuntime();
      await ensurePreload(activeRuntime);
    } catch (error) {
      preloadError = toErrorMessage(error);
    }

    notifyStartupStatus((message) => {
      if (ctx.hasUI) {
        ctx.ui.notify(message, "warning");
      } else {
        emitStderrNotice(message);
      }
    });
  });

  pi.on("before_agent_start", async () => {
    const activeRuntime = await ensureRuntime();
    await ensurePreload(activeRuntime);
  });

  pi.on("session_shutdown", async () => {
    const activeRuntime = runtime;
    runtime = undefined;
    runtimePromise = undefined;
    preloadPromise = undefined;
    preloadWarnings = [];
    preloadError = undefined;
    settings = getDefaultMcporterSettings();
    settingsPromise = undefined;
    catalogStore.clear();
    syncHoistedToolActivation([]);

    if (activeRuntime) {
      await activeRuntime.close().catch(() => {});
    }
  });

  function resolveMode() {
    return settings.mode;
  }

  function ensurePreload(activeRuntime: Runtime): Promise<void> | undefined {
    const mode = resolveMode();
    if (!shouldPreloadCatalog(mode, settings.serverModes)) {
      preloadWarnings = [];
      preloadError = undefined;
      return undefined;
    }

    if (!preloadPromise) {
      preloadPromise = preloadCatalogForMode(
        activeRuntime,
        catalogStore,
        mode,
        settings.serverModes,
      )
        .then((summary) => {
          preloadWarnings = summary.warnings;
          preloadError = undefined;

          if (summary.hoistedTools.length > 0) {
            const hoistedToolNames = registerHoistedTools(
              pi,
              ensureRuntime,
              catalogStore,
              summary.hoistedTools,
              resolveCallTimeout,
              registeredHoistedSelectors,
              registeredHoistedNames,
            );
            syncHoistedToolActivation([
              ...activeHoistedToolNames,
              ...hoistedToolNames,
            ]);
          }
        })
        .catch((error) => {
          preloadPromise = undefined;
          preloadWarnings = [];
          preloadError = toErrorMessage(error);
          throw error;
        });
    }

    return preloadPromise;
  }

  function syncHoistedToolActivation(nextToolNames: Iterable<string>): void {
    const desiredToolNames = new Set(nextToolNames);
    const activeToolNames = new Set(pi.getActiveTools());

    for (const toolName of activeHoistedToolNames) {
      if (!desiredToolNames.has(toolName)) {
        activeToolNames.delete(toolName);
      }
    }
    for (const toolName of desiredToolNames) {
      activeToolNames.add(toolName);
    }

    activeHoistedToolNames = desiredToolNames;
    pi.setActiveTools([...activeToolNames]);
  }

  function notifyStartupStatus(notify: (message: string) => void): void {
    if (preloadError) {
      notify(`mcporter extension: ${preloadError}`);
    }
    if (preloadWarnings.length > 0) {
      notify(
        `mcporter extension: metadata unavailable for ${preloadWarnings.length} server(s).`,
      );
    }
  }

  async function ensureSettings(): Promise<McporterSettings> {
    if (settingsPromise) {
      return await settingsPromise;
    }

    settingsPromise = loadMcporterSettings()
      .then((loaded) => {
        settings = loaded;
        return loaded;
      })
      .catch((error) => {
        settingsPromise = undefined;
        throw error;
      });

    return await settingsPromise;
  }

  function resolveConfiguredPath(
    loadedSettings: McporterSettings,
  ): string | undefined {
    const env = process.env.MCPORTER_CONFIG;
    if (typeof env === "string" && env.trim().length > 0) {
      return env.trim();
    }

    return loadedSettings.configPath;
  }

  async function ensureRuntime(): Promise<Runtime> {
    if (runtime) {
      return runtime;
    }
    if (!runtimePromise) {
      runtimePromise = ensureSettings()
        .then((loadedSettings) => {
          const configPath = resolveConfiguredPath(loadedSettings);
          return createRuntime({
            ...(configPath ? { configPath } : {}),
            clientInfo: { name: "pi-mcporter", version: PACKAGE_VERSION },
          });
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
    return resolveCallTimeoutFromInputs(override, String(settings.timeoutMs));
  }

  try {
    await ensureSettings();
    if (shouldPreloadCatalog(settings.mode, settings.serverModes)) {
      const activeRuntime = await ensureRuntime();
      await ensurePreload(activeRuntime);
    }
  } catch (error) {
    preloadError = toErrorMessage(error);
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
