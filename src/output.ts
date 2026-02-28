import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	truncateTail,
} from "@mariozechner/pi-coding-agent";
import { wrapCallResult } from "mcporter";
import { renderSchemaSnippet } from "./schema.js";
import type { OutputShape } from "./types.js";

export function formatCallOutput(selector: string, rawResult: unknown): string {
	const wrapped = wrapCallResult(rawResult).callResult;
	const lines: string[] = [];

	lines.push(`Called ${selector} successfully.`);

	const text = wrapped.text();
	if (text && text.trim().length > 0) {
		lines.push("");
		lines.push("Text response:");
		lines.push(text.trim());
	}

	const structured = wrapped.structuredContent();
	if (structured !== null && structured !== undefined) {
		lines.push("");
		lines.push("Structured content snippet:");
		lines.push(renderSchemaSnippet(structured));
	} else {
		const parsedJson = wrapped.json();
		if (parsedJson !== null && parsedJson !== undefined) {
			lines.push("");
			lines.push("JSON payload snippet:");
			lines.push(renderSchemaSnippet(parsedJson));
		}
	}

	if (lines.length === 1) {
		lines.push("");
		lines.push("Raw result envelope snippet:");
		lines.push(renderSchemaSnippet(rawResult));
	}

	return lines.join("\n");
}

export async function shapeOutput(output: string): Promise<OutputShape> {
	return shapeWithStrategy(output, truncateHead);
}

export async function shapeCallOutput(output: string): Promise<OutputShape> {
	return shapeWithStrategy(output, truncateTail);
}

async function shapeWithStrategy(
	output: string,
	truncate: typeof truncateHead,
): Promise<OutputShape> {
	const truncation = truncate(output, {
		maxBytes: DEFAULT_MAX_BYTES,
		maxLines: DEFAULT_MAX_LINES,
	});

	if (!truncation.truncated) {
		return { text: truncation.content };
	}

	const fullOutputPath = await writeTempText(output);
	const omittedLines = truncation.totalLines - truncation.outputLines;
	const omittedBytes = truncation.totalBytes - truncation.outputBytes;

	let text = truncation.content;
	text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
	text += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
	text += ` ${omittedLines} line(s) and ${formatSize(omittedBytes)} omitted.`;
	text += ` Full output saved to: ${fullOutputPath}]`;

	return { text, truncation, fullOutputPath };
}

async function writeTempText(content: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-mcporter-"));
	const file = join(dir, "output.txt");
	await writeFile(file, content, "utf8");
	return file;
}
