import { describe, expect, it } from "vitest";
import type { Runtime, ServerToolInfo } from "mcporter";
import { CatalogStore } from "../src/catalog-store.ts";
import mcporterExtension, { __test__ } from "../src/index.ts";
import { formatCallOutput, summarizeCallOutput } from "../src/output.ts";
import { preloadCatalogForMode } from "../src/startup.ts";

describe("mcporter renderer", () => {
  it("collapses describe output until expanded", () => {
    const { tool } = createExtensionHarness();

    const collapsed = renderComponentText(
      tool.renderResult(
        {
          content: [
            { type: "text", text: "linear.list_issues\nLong schema body" },
          ],
          details: { action: "describe", selector: "linear.list_issues" },
        },
        { expanded: false, isPartial: false },
        createTheme(),
      ),
    );
    const expanded = renderComponentText(
      tool.renderResult(
        {
          content: [
            { type: "text", text: "linear.list_issues\nLong schema body" },
          ],
          details: { action: "describe", selector: "linear.list_issues" },
        },
        { expanded: true, isPartial: false },
        createTheme(),
      ),
    );

    expect(collapsed).toContain("linear.list_issues schema available");
    expect(collapsed).toContain("to expand");
    expect(collapsed).not.toContain("Long schema body");
    expect(expanded).toContain("Long schema body");
  });

  it("collapses search output until expanded", () => {
    const { tool } = createExtensionHarness();

    const collapsed = renderComponentText(
      tool.renderResult(
        {
          content: [
            {
              type: "text",
              text: "Found 2 match(es) for 'linear' across 4 server(s).\n\n- linear.list_issues",
            },
          ],
          details: { action: "search", resultCount: 2 },
        },
        { expanded: false, isPartial: false },
        createTheme(),
      ),
    );
    const expanded = renderComponentText(
      tool.renderResult(
        {
          content: [
            {
              type: "text",
              text: "Found 2 match(es) for 'linear' across 4 server(s).\n\n- linear.list_issues",
            },
          ],
          details: { action: "search", resultCount: 2 },
        },
        { expanded: true, isPartial: false },
        createTheme(),
      ),
    );

    expect(collapsed).toContain(
      "Found 2 match(es) for 'linear' across 4 server(s).",
    );
    expect(collapsed).toContain("to expand");
    expect(collapsed).not.toContain("- linear.list_issues");
    expect(expanded).toContain("- linear.list_issues");
  });

  it("collapses call output until expanded", () => {
    const { tool } = createExtensionHarness();

    const collapsed = renderComponentText(
      tool.renderResult(
        {
          content: [{ type: "text", text: "full output" }],
          details: {
            action: "call",
            selector: "demo.echo",
            callOutputSummary: "demo.echo: text output",
          },
        },
        { expanded: false, isPartial: false },
        createTheme(),
      ),
    );
    const expanded = renderComponentText(
      tool.renderResult(
        {
          content: [{ type: "text", text: "full output" }],
          details: {
            action: "call",
            selector: "demo.echo",
            callOutputSummary: "demo.echo: text output",
          },
        },
        { expanded: true, isPartial: false },
        createTheme(),
      ),
    );

    expect(collapsed).toContain("demo.echo: text output");
    expect(collapsed).toContain("to expand");
    expect(collapsed).not.toContain("full output");
    expect(expanded).toContain("full output");
  });

  it("shows compact call args in the call header", () => {
    const { tool } = createExtensionHarness();

    const rendered = renderComponentText(
      tool.renderCall(
        {
          action: "call",
          selector: "linear.list_issues",
          args: { team: "PI", limit: 10, state: "Todo" },
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain("mcporter call linear.list_issues");
    expect(rendered).toContain("\n  team=PI limit=10 state=Todo");
  });

  it("sizes call arg previews to the available width", () => {
    const { tool } = createExtensionHarness();

    const wide = renderComponentText(
      tool.renderCall(
        {
          action: "call",
          selector: "linear.list_issues",
          args: {
            assignee: "me",
            limit: 100,
            orderBy: "updatedAt",
            includeArchived: false,
          },
        },
        createTheme(),
      ),
      120,
    );
    const narrow = renderComponentText(
      tool.renderCall(
        {
          action: "call",
          selector: "linear.list_issues",
          args: {
            assignee: "me",
            limit: 100,
            orderBy: "updatedAt",
            includeArchived: false,
          },
        },
        createTheme(),
      ),
      50,
    );

    expect(wide).toContain("assignee=me");
    expect(wide).toContain("orderBy=updatedAt");
    expect(wide).toContain("includeArchived=false");
    expect(narrow).toContain("mcporter call linear.list_issues");
    expect(narrow).toContain("assignee=me");
    expect(narrow).toContain("...");
    expect(narrow).not.toContain("includeArchived=false");
  });

  it("renders multiline array argsJson previews as a single header line", () => {
    const { tool } = createExtensionHarness();

    const rendered = renderComponentText(
      tool.renderCall(
        {
          action: "call",
          selector: "demo.echo",
          argsJson:
            '{\n  "items": [\n    1,\n    2\n  ],\n  "nested": {\n    "ok": true\n  }\n}',
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered.split("\n")).toHaveLength(2);
    expect(rendered).toContain('\n  items=[1,2] nested={"ok":true}');
  });

  it("omits empty call args from the call header", () => {
    const { tool } = createExtensionHarness();

    const rendered = renderComponentText(
      tool.renderCall(
        {
          action: "call",
          selector: "linear.list_issues",
          args: {},
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toBe("mcporter call linear.list_issues");
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

describe("call args preview formatting", () => {
  it("formats argsJson as compact single-line JSON", () => {
    expect(
      __test__.formatCallArgsPreview(
        {
          action: "call",
          selector: "demo.echo",
          argsJson: '{\n  "team": "PI",\n  "limit": 10\n}',
        },
        40,
      ),
    ).toBe("team=PI limit=10");
  });

  it("preserves whitespace inside string literals", () => {
    expect(
      __test__.formatCallArgsPreview(
        {
          action: "call",
          selector: "demo.echo",
          argsJson:
            '{\n  "query": "  keep   internal spaces  ",\n  "regex": "^foo  bar$"\n}',
        },
        40,
      ),
    ).toBe('query="  keep   internal spaces  " regex...');
  });

  it("compacts multiline array values in argsJson", () => {
    expect(
      __test__.formatCallArgsPreview(
        {
          action: "call",
          selector: "demo.echo",
          argsJson:
            '{\n  "items": [\n    1,\n    2\n  ],\n  "nested": {\n    "ok": true\n  }\n}',
        },
        40,
      ),
    ).toBe('items=[1,2] nested={"ok":true}');
  });

  it("truncates long args previews", () => {
    expect(
      __test__.formatCallArgsPreview(
        {
          action: "call",
          selector: "demo.echo",
          args: {
            query:
              "this is a deliberately long string that should be truncated",
          },
        },
        40,
      ),
    ).toBe('query="this is a deliberately long strin...');
  });
});

describe("mode resolution", () => {
  it("defaults to lazy", () => {
    expect(__test__.resolveMcporterMode(undefined)).toBe("lazy");
  });

  it("accepts eager and hoist", () => {
    expect(__test__.resolveMcporterMode("eager")).toBe("eager");
    expect(__test__.resolveMcporterMode("HOIST")).toBe("hoist");
  });

  it("falls back to lazy for unknown values", () => {
    expect(__test__.resolveMcporterMode("surprise")).toBe("lazy");
  });
});

describe("startup preload", () => {
  it("warms the basic catalog in eager mode", async () => {
    const seenOptions: Array<{ includeSchema?: boolean }> = [];
    const runtime = createRuntimeStub(async (server, options) => {
      seenOptions.push({ includeSchema: options?.includeSchema });
      if (server === "beta") {
        throw new Error("offline");
      }
      return [demoTool(server, "list_items")];
    }, ["alpha", "beta"]);

    const summary = await preloadCatalogForMode(
      runtime,
      new CatalogStore(),
      "eager",
    );

    expect(summary.warmedServers).toEqual(["alpha"]);
    expect(summary.hoistedTools).toEqual([]);
    expect(summary.warnings).toEqual(["beta: offline"]);
    expect(seenOptions).toEqual([
      { includeSchema: false },
      { includeSchema: false },
    ]);
  });

  it("loads schemas for hoist mode", async () => {
    const seenOptions: Array<{ includeSchema?: boolean }> = [];
    const runtime = createRuntimeStub(async (server, options) => {
      seenOptions.push({ includeSchema: options?.includeSchema });
      return [
        demoTool(server, "list_items", {
          type: "object",
          properties: { limit: { type: "number" } },
        }),
      ];
    }, ["alpha"]);

    const summary = await preloadCatalogForMode(
      runtime,
      new CatalogStore(),
      "hoist",
    );

    expect(summary.warmedServers).toEqual(["alpha"]);
    expect(summary.hoistedTools.map((tool) => tool.selector)).toEqual([
      "alpha.list_items",
    ]);
    expect(seenOptions).toEqual([{ includeSchema: true }]);
  });
});

function demoTool(
  server: string,
  name: string,
  inputSchema?: unknown,
): ServerToolInfo {
  return {
    name,
    description: `${server}.${name}`,
    inputSchema,
  };
}

function createRuntimeStub(
  listTools: Runtime["listTools"],
  servers: string[],
): Runtime {
  return {
    listServers: () => [...servers],
    listTools,
    getDefinitions: () => [],
    getDefinition: () => {
      throw new Error("not implemented");
    },
    registerDefinition: () => {},
    callTool: async () => ({}),
    listResources: async () => ({}),
    connect: async () => {
      throw new Error("not implemented");
    },
    close: async () => {},
  } as unknown as Runtime;
}

function createExtensionHarness(): {
  tool: {
    renderCall: (
      args: unknown,
      theme: ReturnType<typeof createTheme>,
    ) => { render: (width: number) => string[] };
    renderResult: (
      result: unknown,
      options: { expanded: boolean; isPartial: boolean },
      theme: ReturnType<typeof createTheme>,
    ) => { render: (width: number) => string[] };
  };
} {
  let tool:
    | {
        renderCall: (
          args: unknown,
          theme: ReturnType<typeof createTheme>,
        ) => { render: (width: number) => string[] };
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
    registerCommand() {},
    registerFlag(name: string, options: { default?: string }) {
      if (options.default !== undefined) {
        flags.set(name, options.default);
      }
    },
    registerTool(definition: unknown) {
      tool = definition as typeof tool;
    },
  } as never);

  if (!tool) {
    throw new Error("Failed to register mcporter extension test harness");
  }

  return { tool };
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

function renderComponentText(
  component: {
    render: (width: number) => string[];
  },
  width: number = 120,
): string {
  return component.render(width).join("\n").trim();
}
