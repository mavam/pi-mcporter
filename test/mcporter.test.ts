import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	getMcporterConfigPath,
	loadMcporterConfig,
	resolveMcporterCallOutputMode,
	writeMcporterCallOutputMode,
} from "../src/mcporter-config.ts";
import { parseMcporterCommand } from "../src/mcporter-command.ts";
import { formatCallOutput, summarizeCallOutput } from "../src/output.ts";

describe("parseMcporterCommand", () => {
	it("opens settings with no args", () => {
		expect(parseMcporterCommand("")).toEqual({ action: "open" });
	});

	it("parses status", () => {
		expect(parseMcporterCommand("status")).toEqual({ action: "status" });
	});

	it("defaults bare modes to global scope", () => {
		expect(parseMcporterCommand("summary")).toEqual({
			action: "set",
			mode: "summary",
		});
	});

	it("rejects invalid arguments", () => {
		const parsed = parseMcporterCommand("global off");
		expect("error" in parsed && parsed.error).toContain("/mcporter <full");
	});
});

describe("resolveMcporterCallOutputMode", () => {
	it("falls back to summary by default", () => {
		expect(resolveMcporterCallOutputMode(undefined)).toBe("summary");
	});
});

describe("mcporter config loading and writing", () => {
	it("falls back safely when config contains invalid JSON", async () => {
		const fixture = await createConfigFixture();
		await mkdir(join(fixture.homeDir, ".pi", "agent"), { recursive: true });
		await writeFile(
			join(fixture.homeDir, ".pi", "agent", "mcporter.json"),
			"{ bad json",
			"utf8",
		);

		const loaded = await loadMcporterConfig({ homeDir: fixture.homeDir });

		expect(loaded.effectiveCallOutputMode).toBe("summary");
		expect(loaded.warnings).toHaveLength(1);
		expect(loaded.warnings[0]).toContain("Ignoring invalid mcporter config");
	});

	it("writes the global mode", async () => {
		const fixture = await createConfigFixture();
		const loaded = await writeMcporterCallOutputMode("off", {
			homeDir: fixture.homeDir,
		});

		expect(loaded.config.callOutputMode).toBe("off");
		expect(loaded.effectiveCallOutputMode).toBe("off");
		expect(loaded.path).toBe(getMcporterConfigPath(fixture.homeDir));
	});
});

describe("call output formatting", () => {
	it("classifies text responses", () => {
		const formatted = formatCallOutput("demo.echo", {
			content: [{ type: "text", text: "Hello world" }],
		});

		expect(formatted.kind).toBe("text");
		expect(formatted.text).toContain("Text response:");
	});

	it("classifies structured responses", () => {
		const formatted = formatCallOutput("demo.structured", {
			structuredContent: { ok: true },
		});

		expect(formatted.kind).toBe("structured");
		expect(formatted.text).toContain("Structured content snippet:");
	});

	it("classifies JSON responses", () => {
		const formatted = formatCallOutput("demo.json", {
			content: [{ type: "json", json: { ok: true } }],
		});

		expect(formatted.kind).toBe("json");
		expect(formatted.text).toContain("JSON payload snippet:");
	});

	it("falls back to raw envelopes", () => {
		const formatted = formatCallOutput("demo.raw", { ok: true });

		expect(formatted.kind).toBe("raw");
		expect(formatted.text).toContain("Raw result envelope snippet:");
	});

	it("marks truncated summaries", () => {
		expect(summarizeCallOutput("demo.echo", "text", true)).toContain(
			"[truncated]",
		);
	});
});

async function createConfigFixture(): Promise<{ homeDir: string }> {
	const root = await mkdtemp(join(tmpdir(), "pi-mcporter-test-"));
	const homeDir = join(root, "home");
	await mkdir(homeDir, { recursive: true });
	return { homeDir };
}
