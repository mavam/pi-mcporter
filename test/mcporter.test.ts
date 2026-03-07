import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import mcporterExtension from "../src/index.ts";
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
	it("uses pi's configured agent dir by default", async () => {
		const fixture = await createAgentDirFixture();
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = fixture.agentDir;

		try {
			expect(getMcporterConfigPath()).toBe(
				join(fixture.agentDir, "mcporter.json"),
			);
		} finally {
			restoreEnv("PI_CODING_AGENT_DIR", previousAgentDir);
		}
	});

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

describe("/mcporter command integration", () => {
	it("renders expanded call output even when off mode is configured", async () => {
		const fixture = await createAgentDirFixture();
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = fixture.agentDir;

		try {
			const { command, tool } = createExtensionHarness();
			await command.handler("off", {
				hasUI: true,
				ui: { notify: vi.fn() },
			});

			const expanded = renderComponentText(
				tool.renderResult(
					{
						content: [{ type: "text", text: "full output" }],
						details: { action: "call", selector: "demo.echo" },
					},
					{ expanded: true, isPartial: false },
					createTheme(),
				),
			);
			const collapsed = renderComponentText(
				tool.renderResult(
					{
						content: [{ type: "text", text: "full output" }],
						details: { action: "call", selector: "demo.echo" },
					},
					{ expanded: false, isPartial: false },
					createTheme(),
				),
			);

			expect(expanded).toContain("full output");
			expect(collapsed).toContain("output hidden by /mcporter");
		} finally {
			restoreEnv("PI_CODING_AGENT_DIR", previousAgentDir);
		}
	});

	it("emits visible status text without UI", async () => {
		const fixture = await createAgentDirFixture();
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = fixture.agentDir;
		const stderr: string[] = [];
		const stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(((chunk: string | Uint8Array) => {
				stderr.push(String(chunk));
				return true;
			}) as typeof process.stderr.write);

		try {
			const { command } = createExtensionHarness();
			const notify = vi.fn();
			await command.handler("status", {
				hasUI: false,
				ui: { notify },
			});

			expect(notify).not.toHaveBeenCalled();
			expect(stderr.join("")).toContain(
				`mcporter call output: summary (${join(fixture.agentDir, "mcporter.json")})`,
			);
		} finally {
			stderrSpy.mockRestore();
			restoreEnv("PI_CODING_AGENT_DIR", previousAgentDir);
		}
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

async function createAgentDirFixture(): Promise<{ agentDir: string }> {
	const root = await mkdtemp(join(tmpdir(), "pi-mcporter-agent-"));
	const agentDir = join(root, "custom-agent");
	await mkdir(agentDir, { recursive: true });
	return { agentDir };
}

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

function createExtensionHarness(): {
	command: {
		handler: (
			args: string,
			ctx: { hasUI: boolean; ui: { notify: (message: string, level?: string) => void } },
		) => Promise<void>;
	};
	tool: {
		renderResult: (
			result: unknown,
			options: { expanded: boolean; isPartial: boolean },
			theme: ReturnType<typeof createTheme>,
		) => { render: (width: number) => string[] };
	};
} {
	let command:
		| {
				handler: (
					args: string,
					ctx: {
						hasUI: boolean;
						ui: { notify: (message: string, level?: string) => void };
					},
				) => Promise<void>;
		  }
		| undefined;
	let tool:
		| {
				renderResult: (
					result: unknown,
					options: { expanded: boolean; isPartial: boolean },
					theme: ReturnType<typeof createTheme>,
				) => { render: (width: number) => string[] };
		  }
		| undefined;
	const flags = new Map<string, string>();

	mcporterExtension({
		getFlag(name: string) {
			return flags.get(name);
		},
		on() {},
		registerCommand(name: string, options: unknown) {
			if (name === "mcporter") {
				command = options as typeof command;
			}
		},
		registerFlag(name: string, options: { default?: string }) {
			if (options.default !== undefined) {
				flags.set(name, options.default);
			}
		},
		registerTool(definition: unknown) {
			tool = definition as typeof tool;
		},
	} as never);

	if (!command || !tool) {
		throw new Error("Failed to register mcporter extension test harness");
	}

	return { command, tool };
}

function createTheme() {
	return {
		bold(text: string) {
			return text;
		},
		fg(_color: string, text: string) {
			return text;
		},
	};
}

function renderComponentText(component: { render: (width: number) => string[] }): string {
	return component.render(120).join("\n").trim();
}
