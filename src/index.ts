import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
} from "@mariozechner/pi-coding-agent";
import { createRuntime, type Runtime } from "mcporter";
import { handleCallAction } from "./actions/call.js";
import { handleDescribeAction } from "./actions/describe.js";
import { handleSearchAction } from "./actions/search.js";
import { CatalogStore } from "./catalog-store.js";
import { DEFAULT_CALL_TIMEOUT_MS } from "./constants.js";
import { textContent, toErrorMessage } from "./helpers.js";
import {
	clampLimit,
	parseCallArgs,
	parseSelector,
	resolveCallTimeoutFromInputs,
} from "./inputs.js";
import { McporterParameters, type McporterParams } from "./parameters.js";
import { levenshtein, rankTools, scoreTool, suggest } from "./search.js";

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

export const __test__ = {
	clampLimit,
	levenshtein,
	parseCallArgs,
	parseSelector,
	rankTools,
	resolveCallTimeoutFromInputs,
	scoreTool,
	suggest,
};
