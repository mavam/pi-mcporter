import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { isMcporterCallOutputMode } from "./mcporter-config.js";
import type { McporterCallOutputMode } from "./types.js";

export type ParsedMcporterCommand =
	| { action: "open" }
	| { action: "status" }
	| { action: "set"; mode: McporterCallOutputMode };

export function parseMcporterCommand(
	rawArgs: string,
): ParsedMcporterCommand | { error: string } {
	const args = rawArgs
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	if (args.length === 0) {
		return { action: "open" };
	}

	if (args.length === 1) {
		if (args[0] === "status") {
			return { action: "status" };
		}
		if (isMcporterCallOutputMode(args[0])) {
			return { action: "set", mode: args[0] };
		}
	}

	return { error: mcporterCommandUsage() };
}

export function getMcporterCommandCompletions(
	argumentPrefix: string,
): AutocompleteItem[] | null {
	const values = ["status", "full", "summary", "off"];
	const prefix = argumentPrefix.trim();
	if (!prefix) {
		return values.map(toAutocompleteItem);
	}
	const filtered = values.filter((value) => value.startsWith(prefix));
	return filtered.length > 0 ? filtered.map(toAutocompleteItem) : null;
}

export function mcporterCommandUsage(): string {
	return [
		"Usage:",
		"/mcporter",
		"/mcporter status",
		"/mcporter <full|summary|off>",
	].join(" ");
}

function toAutocompleteItem(value: string): AutocompleteItem {
	return { value, label: value };
}
