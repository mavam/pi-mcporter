import { truncateLine } from "@mariozechner/pi-coding-agent";
import type { Runtime } from "mcporter";
import type { CatalogStore } from "../catalog-store.js";
import { DEFAULT_SEARCH_LIMIT } from "../constants.js";
import { cleanSingleLine, raceAbort, textContent } from "../helpers.js";
import { clampLimit } from "../inputs.js";
import { shapeOutput } from "../output.js";
import type { McporterParams } from "../parameters.js";
import { rankTools } from "../search.js";
import type { ToolDetails } from "../types.js";

export async function handleSearchAction(
	activeRuntime: Runtime,
	params: McporterParams,
	signal: AbortSignal | undefined,
	catalogStore: CatalogStore,
) {
	const catalog = await raceAbort(
		catalogStore.getBasicCatalog(activeRuntime),
		signal,
	);

	const limit = clampLimit(params.limit ?? DEFAULT_SEARCH_LIMIT);
	const query = params.query?.trim() ?? "";
	const matches = rankTools(catalog.tools, query).slice(0, limit);

	const lines: string[] = [];
	const serverCount = catalog.servers.length;
	lines.push(
		query.length > 0
			? `Found ${matches.length} match(es) for '${query}' across ${serverCount} server(s).`
			: `Showing ${matches.length} tool(s) across ${serverCount} server(s).`,
	);

	if (matches.length === 0) {
		lines.push("No tools matched.");
		if (catalog.tools.length > 0) {
			lines.push("Try a shorter query or search by server name.");
		}
	} else {
		lines.push("");
		for (const match of matches) {
			const desc = cleanSingleLine(match.description ?? "");
			const descriptor =
				desc.length > 0 ? ` — ${truncateLine(desc, 140).text}` : "";
			lines.push(`- ${match.selector}${descriptor}`);
		}
	}

	lines.push("");
	lines.push(
		"Next step: use action='describe' with selector='server.tool' for full schema.",
	);

	if (catalog.warnings.length > 0) {
		lines.push("");
		lines.push(
			`Metadata unavailable for ${catalog.warnings.length} server(s) (auth/offline/errors).`,
		);
	}

	const shaped = await shapeOutput(lines.join("\n"));
	return {
		content: textContent(shaped.text),
		details: {
			action: "search",
			resultCount: matches.length,
			cacheAgeMs: Date.now() - catalog.fetchedAt,
			warnings: catalog.warnings,
			truncation: shaped.truncation,
			fullOutputPath: shaped.fullOutputPath,
		} satisfies ToolDetails,
	};
}
