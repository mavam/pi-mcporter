import { describeConnectionIssue, type Runtime } from "mcporter";
import type { CatalogStore } from "../catalog-store.js";
import {
	connectionHints,
	shouldInvalidateCatalogOnCallError,
} from "../errors.js";
import { raceAbort, textContent, toErrorMessage } from "../helpers.js";
import {
	findToolByName,
	formatUnknownTool,
	parseCallArgs,
	parseSelector,
	validateServer,
} from "../inputs.js";
import { formatCallOutput, shapeCallOutput } from "../output.js";
import type { McporterParams } from "../parameters.js";
import type { CatalogTool, ToolDetails } from "../types.js";

export async function handleCallAction(
	activeRuntime: Runtime,
	params: McporterParams,
	signal: AbortSignal | undefined,
	catalogStore: CatalogStore,
	resolveCallTimeout: (override?: number) => number,
) {
	const parsed = parseSelector(params.selector);
	if ("error" in parsed) {
		throw new Error(parsed.error);
	}

	const serverCheck = validateServer(activeRuntime, parsed.server);
	if (serverCheck) {
		throw new Error(serverCheck);
	}

	const argsResult = parseCallArgs(params);
	if ("error" in argsResult) {
		throw new Error(argsResult.error);
	}

	const timeoutMs = resolveCallTimeout(params.timeoutMs);
	const cachedKnownTools = catalogStore.getCachedToolsForServer(parsed.server);
	if (
		cachedKnownTools &&
		cachedKnownTools.length > 0 &&
		!findToolByName(cachedKnownTools, parsed.tool)
	) {
		throw new Error(formatUnknownTool(parsed, cachedKnownTools));
	}

	let rawResult: unknown;
	try {
		rawResult = await raceAbort(
			activeRuntime.callTool(parsed.server, parsed.tool, {
				args: argsResult.args,
				timeoutMs,
			}),
			signal,
		);
	} catch (error) {
		if (shouldInvalidateCatalogOnCallError(error)) {
			catalogStore.invalidate();
		}

		const issue = describeConnectionIssue(error);
		const lines: string[] = [];
		lines.push(`Failed to call '${parsed.raw}': ${toErrorMessage(error)}`);
		lines.push(...connectionHints(issue, parsed.server));

		const maybeUnknownTool = toErrorMessage(error).toLowerCase();
		if (
			maybeUnknownTool.includes("unknown") &&
			maybeUnknownTool.includes("tool")
		) {
			let knownTools: CatalogTool[] = cachedKnownTools ?? [];
			if (knownTools.length === 0) {
				knownTools = await raceAbort(
					catalogStore.getServerCatalogBasic(activeRuntime, parsed.server),
					signal,
				).catch(() => []);
			}
			if (knownTools.length > 0) {
				lines.push(formatUnknownTool(parsed, knownTools));
			}
		}

		throw new Error(lines.join("\n"));
	}

	const text = formatCallOutput(parsed.raw, rawResult);
	const shaped = await shapeCallOutput(text);

	return {
		content: textContent(shaped.text),
		details: {
			action: "call",
			selector: parsed.raw,
			timeoutMs,
			truncation: shaped.truncation,
			fullOutputPath: shaped.fullOutputPath,
		} satisfies ToolDetails,
	};
}
