import { readFile } from "node:fs/promises";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	Theme,
} from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	getSettingsListTheme,
	keyHint,
} from "@mariozechner/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@mariozechner/pi-tui";
import { createRuntime, type Runtime } from "mcporter";
import { handleCallAction } from "./actions/call.js";
import { handleDescribeAction } from "./actions/describe.js";
import { handleSearchAction } from "./actions/search.js";
import { CatalogStore } from "./catalog-store.js";
import {
	DEFAULT_CALL_OUTPUT_MODE,
	DEFAULT_CALL_TIMEOUT_MS,
} from "./constants.js";
import { cleanSingleLine, textContent, toErrorMessage } from "./helpers.js";
import {
	clampLimit,
	parseCallArgs,
	parseSelector,
	resolveCallTimeoutFromInputs,
} from "./inputs.js";
import {
	getMcporterCommandCompletions,
	mcporterCommandUsage,
	parseMcporterCommand,
} from "./mcporter-command.js";
import {
	loadMcporterConfig,
	resolveMcporterCallOutputMode,
	writeMcporterCallOutputMode,
} from "./mcporter-config.js";
import { McporterParameters, type McporterParams } from "./parameters.js";
import { levenshtein, rankTools, scoreTool, suggest } from "./search.js";
import type { McporterCallOutputMode, ToolDetails } from "./types.js";

const PACKAGE_VERSION: string = await readFile(
	new URL("../package.json", import.meta.url),
	"utf8",
)
	.then((raw) => (JSON.parse(raw) as { version: string }).version)
	.catch(() => "0.0.0-dev");

export default function mcporterExtension(pi: ExtensionAPI) {
	let runtime: Runtime | undefined;
	let runtimePromise: Promise<Runtime> | undefined;
	let callOutputMode: McporterCallOutputMode = DEFAULT_CALL_OUTPUT_MODE;
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

	pi.registerCommand("mcporter", {
		description: "Configure mcporter call output display",
		getArgumentCompletions: getMcporterCommandCompletions,
		handler: async (args, ctx) => {
			const parsed = parseMcporterCommand(args);
			if ("error" in parsed) {
				ctx.ui.notify(parsed.error, "warning");
				return;
			}

			const loaded = await refreshCallOutputMode();
			switch (parsed.action) {
				case "open":
					if (!ctx.hasUI) {
						notifyCallOutputStatus(ctx, loaded);
						return;
					}
					await openMcporterSettings(ctx, loaded);
					return;
				case "status":
					notifyCallOutputStatus(ctx, loaded);
					return;
				case "set": {
					const next = await writeMcporterCallOutputMode(parsed.mode);
					applyCallOutputMode(next.effectiveCallOutputMode);
					notifyConfigWarnings(ctx, next.warnings);
					notifyCallOutputStatus(ctx, next);
					return;
				}
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			const loaded = await refreshCallOutputMode();
			notifyConfigWarnings(ctx, loaded.warnings);
		} catch (error) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`mcporter extension: ${toErrorMessage(error)}`,
					"warning",
				);
			}
		}

		try {
			await ensureRuntime();
		} catch (error) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`mcporter extension: ${toErrorMessage(error)}`,
					"warning",
				);
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
			let text = theme.fg("toolTitle", theme.bold("mcporter"));
			text += ` ${theme.fg("accent", args.action)}`;

			if (
				(args.action === "describe" || args.action === "call") &&
				typeof args.selector === "string" &&
				args.selector.trim().length > 0
			) {
				text += ` ${theme.fg("muted", args.selector.trim())}`;
			} else if (
				args.action === "search" &&
				typeof args.query === "string" &&
				args.query.trim().length > 0
			) {
				text += ` ${theme.fg("muted", `"${cleanSingleLine(args.query).slice(0, 80)}"`)}`;
			}

			return new Text(text, 0, 0);
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

			if (details?.action !== "call") {
				return renderBlockText(text ?? "", theme, "toolOutput");
			}

			if (callOutputMode === "full") {
				return renderBlockText(text ?? "", theme, "toolOutput");
			}

			if (callOutputMode === "off") {
				return renderSimpleText(
					`${details.selector ?? "mcporter call"} output hidden by /mcporter`,
					theme,
					"muted",
				);
			}

			if (expanded) {
				return renderBlockText(text ?? "", theme, "toolOutput");
			}

			const summary =
				details.callOutputSummary ??
				`${details.selector ?? "mcporter call"}: output available`;
			let summaryText = theme.fg("success", summary);
			summaryText += theme.fg(
				"muted",
				` (${keyHint("expandTools", "to expand")})`,
			);
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

	async function refreshCallOutputMode() {
		const loaded = await loadMcporterConfig();
		applyCallOutputMode(loaded.effectiveCallOutputMode);
		return loaded;
	}

	async function openMcporterSettings(
		ctx: ExtensionCommandContext,
		initialConfig: Awaited<ReturnType<typeof loadMcporterConfig>>,
	): Promise<void> {
		let currentConfig = initialConfig;
		await ctx.ui.custom((tui, theme, _kb, done) => {
			const settingsItems: SettingItem[] = [
				{
					id: "call-output",
					label: "Call output",
					description: `Stored in ${currentConfig.path}`,
					currentValue:
						currentConfig.config.callOutputMode ?? DEFAULT_CALL_OUTPUT_MODE,
					values: ["full", "summary", "off"],
				},
			];

			const settingsList = new SettingsList(
				settingsItems,
				4,
				getSettingsListTheme(),
				(_settingId, newValue) => {
					const previousValue =
						currentConfig.config.callOutputMode ?? DEFAULT_CALL_OUTPUT_MODE;
					void persistSettingsChange(newValue, previousValue);
				},
				() => {
					done(undefined);
				},
			);

			const header = new (class {
				render(_width: number) {
					return [
						theme.fg("accent", theme.bold("MCPorter Settings")),
						theme.fg(
							"muted",
							`Effective call output: ${currentConfig.effectiveCallOutputMode}`,
						),
						"",
					];
				}
				invalidate() {}
			})();

			const container = new Container();
			container.addChild(header);
			container.addChild(settingsList);

			async function persistSettingsChange(
				newValue: string,
				previousValue: string,
			): Promise<void> {
				try {
					const nextConfig = await writeMcporterCallOutputMode(
						newValue as McporterCallOutputMode,
					);
					currentConfig = nextConfig;
					applyCallOutputMode(nextConfig.effectiveCallOutputMode);
					settingsList.updateValue(
						"call-output",
						nextConfig.config.callOutputMode ?? DEFAULT_CALL_OUTPUT_MODE,
					);
					notifyConfigWarnings(ctx, nextConfig.warnings);
				} catch (error) {
					settingsList.updateValue("call-output", previousValue);
					ctx.ui.notify(toErrorMessage(error), "warning");
				} finally {
					tui.requestRender();
				}
			}

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					settingsList.handleInput?.(data);
					tui.requestRender();
				},
			};
		});
	}

	function applyCallOutputMode(mode: McporterCallOutputMode): void {
		callOutputMode = mode;
	}

	function notifyConfigWarnings(
		ctx: { hasUI: boolean; ui: { notify: (message: string, level: "warning") => void } },
		warnings: string[],
	): void {
		if (!ctx.hasUI) {
			return;
		}
		for (const warning of warnings) {
			ctx.ui.notify(warning, "warning");
		}
	}

	function notifyCallOutputStatus(
		ctx: {
			ui: { notify: (message: string, level: "info") => void };
		},
		loaded: Awaited<ReturnType<typeof loadMcporterConfig>>,
	): void {
		ctx.ui.notify(
			`mcporter call output: ${loaded.effectiveCallOutputMode} (${loaded.path})`,
			"info",
		);
	}

	function resolveCallTimeout(override?: number): number {
		const flagValue = pi.getFlag("mcporter-timeout-ms");
		return resolveCallTimeoutFromInputs(
			override,
			typeof flagValue === "string" ? flagValue : undefined,
		);
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

export const __test__ = {
	clampLimit,
	levenshtein,
	mcporterCommandUsage,
	parseCallArgs,
	parseMcporterCommand,
	parseSelector,
	rankTools,
	resolveCallTimeoutFromInputs,
	resolveMcporterCallOutputMode,
	scoreTool,
	suggest,
};
