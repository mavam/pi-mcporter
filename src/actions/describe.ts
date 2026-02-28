import { describeConnectionIssue, type Runtime } from "mcporter";
import type { CatalogStore } from "../catalog-store.js";
import { connectionHints } from "../errors.js";
import {
	cleanParagraph,
	raceAbort,
	textContent,
	toErrorMessage,
} from "../helpers.js";
import {
	findToolByName,
	formatUnknownTool,
	parseSelector,
	validateServer,
} from "../inputs.js";
import { shapeOutput } from "../output.js";
import type { McporterParams } from "../parameters.js";
import {
	renderSchemaSnippet,
	summarizeInputSchema,
	summarizeOutputSchema,
} from "../schema.js";
import type { CatalogTool, ToolDetails } from "../types.js";

export async function handleDescribeAction(
	activeRuntime: Runtime,
	params: McporterParams,
	signal: AbortSignal | undefined,
	catalogStore: CatalogStore,
) {
	const parsed = parseSelector(params.selector);
	if ("error" in parsed) {
		throw new Error(parsed.error);
	}

	const serverCheck = validateServer(activeRuntime, parsed.server);
	if (serverCheck) {
		throw new Error(serverCheck);
	}

	let tools: CatalogTool[];
	try {
		tools = await raceAbort(
			catalogStore.getServerCatalogWithSchema(activeRuntime, parsed.server),
			signal,
		);
	} catch (error) {
		catalogStore.dropSchemaServer(parsed.server);
		const issue = describeConnectionIssue(error);
		const message = [
			`Failed to describe '${parsed.raw}': ${toErrorMessage(error)}`,
			...connectionHints(issue, parsed.server),
		].join("\n");
		throw new Error(message);
	}

	const resolved = findToolByName(tools, parsed.tool);
	if (!resolved) {
		throw new Error(formatUnknownTool(parsed, tools));
	}

	const lines: string[] = [];
	lines.push(`${resolved.selector}`);
	if (resolved.description) {
		lines.push(cleanParagraph(resolved.description));
	}
	lines.push("");
	lines.push(...summarizeInputSchema(resolved.inputSchema));
	lines.push("");
	lines.push(...summarizeOutputSchema(resolved.outputSchema));
	lines.push("");
	lines.push("Raw schema snippet:");
	lines.push(
		renderSchemaSnippet({
			inputSchema: resolved.inputSchema,
			outputSchema: resolved.outputSchema,
		}),
	);

	const shaped = await shapeOutput(lines.join("\n"));
	return {
		content: textContent(shaped.text),
		details: {
			action: "describe",
			selector: resolved.selector,
			truncation: shaped.truncation,
			fullOutputPath: shaped.fullOutputPath,
		} satisfies ToolDetails,
	};
}
