import {
	formatSize,
	truncateHead,
	truncateLine,
} from "@mariozechner/pi-coding-agent";
import {
	SCHEMA_SNIPPET_MAX_BYTES,
	SCHEMA_SNIPPET_MAX_LINES,
} from "./constants.js";
import { cleanSingleLine, isRecord, safeStringify } from "./helpers.js";

export function summarizeInputSchema(schema: unknown): string[] {
	const lines: string[] = [];
	if (!isRecord(schema)) {
		lines.push("Input: schema unavailable.");
		return lines;
	}

	const properties = isRecord(schema.properties) ? schema.properties : {};
	const propertyNames = Object.keys(properties);
	const required = new Set<string>(
		Array.isArray(schema.required)
			? schema.required.filter(
					(entry): entry is string => typeof entry === "string",
				)
			: [],
	);

	if (propertyNames.length === 0) {
		lines.push("Input: no parameters.");
		return lines;
	}

	lines.push(
		`Input parameters (${required.size} required, ${propertyNames.length - required.size} optional):`,
	);

	const preview = propertyNames.slice(0, 20);
	for (const name of preview) {
		const propertySchema = properties[name];
		const type = schemaTypeSummary(propertySchema);
		const desc = propertyDescription(propertySchema);
		let line = `- ${name}${required.has(name) ? " (required)" : ""}: ${type}`;
		if (desc) {
			line += ` — ${desc}`;
		}
		lines.push(truncateLine(line, 200).text);
	}

	if (propertyNames.length > preview.length) {
		lines.push(
			`- … ${propertyNames.length - preview.length} more parameter(s)`,
		);
	}

	return lines;
}

export function summarizeOutputSchema(schema: unknown): string[] {
	if (!isRecord(schema)) {
		return ["Output: schema unavailable."];
	}

	const type = schemaTypeSummary(schema);
	const description = propertyDescription(schema);
	if (description) {
		return [`Output: ${type} — ${description}`];
	}
	return [`Output: ${type}`];
}

export function renderSchemaSnippet(schema: unknown): string {
	const serialized = safeStringify(schema, 2);
	const snippet = truncateHead(serialized, {
		maxBytes: SCHEMA_SNIPPET_MAX_BYTES,
		maxLines: SCHEMA_SNIPPET_MAX_LINES,
	});

	if (!snippet.truncated) {
		return snippet.content;
	}

	return [
		snippet.content,
		`[schema snippet truncated: ${snippet.outputLines}/${snippet.totalLines} lines, ` +
			`${formatSize(snippet.outputBytes)}/${formatSize(snippet.totalBytes)}]`,
	].join("\n");
}

function schemaTypeSummary(schema: unknown): string {
	if (!isRecord(schema)) {
		return "unknown";
	}

	if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		const preview = schema.enum
			.slice(0, 4)
			.map((entry) => JSON.stringify(entry));
		return schema.enum.length > 4
			? `${preview.join(" | ")} | …`
			: preview.join(" | ");
	}

	const primitive = schema.type;
	if (typeof primitive === "string") {
		if (primitive === "array") {
			const itemType = schemaTypeSummary(schema.items);
			return `${itemType}[]`;
		}

		if (primitive === "object") {
			if (isRecord(schema.properties)) {
				const keys = Object.keys(schema.properties);
				if (keys.length === 0) {
					return "object";
				}
				const preview = keys.slice(0, 3).join(", ");
				return keys.length > 3 ? `object{${preview}, …}` : `object{${preview}}`;
			}
			return "object";
		}

		return primitive;
	}

	if (Array.isArray(primitive) && primitive.length > 0) {
		return primitive.join(" | ");
	}

	if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
		const variants = schema.anyOf
			.slice(0, 4)
			.map((item) => schemaTypeSummary(item));
		return schema.anyOf.length > 4
			? `${variants.join(" | ")} | …`
			: variants.join(" | ");
	}

	if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
		const variants = schema.oneOf
			.slice(0, 4)
			.map((item) => schemaTypeSummary(item));
		return schema.oneOf.length > 4
			? `${variants.join(" | ")} | …`
			: variants.join(" | ");
	}

	return "unknown";
}

function propertyDescription(schema: unknown): string {
	if (!isRecord(schema) || typeof schema.description !== "string") {
		return "";
	}

	return cleanSingleLine(schema.description).slice(0, 140);
}
