import { beforeAll, describe, expect, it } from "vitest";
import type { Runtime, ServerToolInfo } from "mcporter";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { handleSearchAction } from "../src/actions/search.ts";
import { CatalogStore } from "../src/catalog-store.ts";
import mcporterExtension, { __test__ } from "../src/index.ts";
import { formatCallOutput, summarizeCallOutput } from "../src/output.ts";

beforeAll(() => {
  initTheme("dark", false);
});

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
    expect(expanded).toContain("linear.list_issues");
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

  it("redacts sensitive call args in the call header", () => {
    const { tool } = createExtensionHarness();

    const rendered = renderComponentText(
      tool.renderCall(
        {
          action: "call",
          selector: "demo.login",
          args: {
            team: "PI",
            apiKey: "top-secret",
            password: "hunter2",
          },
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain("team=PI");
    expect(rendered).toContain("apiKey=[redacted]");
    expect(rendered).toContain("password=[redacted]");
    expect(rendered).not.toContain("top-secret");
    expect(rendered).not.toContain("hunter2");
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

describe("search output formatting", () => {
  it("returns a known server alongside its matching tools", async () => {
    const runtime = createRuntimeStub(
      async () => [
        demoTool("linear", "list_issues", undefined, "List issues by status"),
      ],
      ["linear"],
    );

    const result = await handleSearchAction(
      runtime,
      { action: "search", query: "linear" },
      undefined,
      new CatalogStore(),
    );

    const text = extractResultText(result);
    expect(text).toContain(
      "Found 1 server match and 1 tool match for 'linear' across 1 known MCP server.",
    );
    expect(text).toContain("- `linear` — 1 tool available");
    expect(text).toContain("- `linear.list_issues`: List issues by status");
    expect(text).toContain("choose a `server.tool` selector");
    expect(result.details).toMatchObject({
      resultCount: 2,
      serverResultCount: 1,
      toolResultCount: 1,
    });
  });

  it("finds tools from a natural-language capability query", async () => {
    const runtime = createRuntimeStub(
      async () => [
        demoTool("linear", "create_issue", undefined, "Create a new issue"),
        demoTool("linear", "list_teams", undefined, "List teams"),
      ],
      ["linear"],
    );

    const result = await handleSearchAction(
      runtime,
      {
        action: "search",
        query: "find a tool for creating Linear issues",
      },
      undefined,
      new CatalogStore(),
    );

    const text = extractResultText(result);
    expect(text).toContain("- `linear.create_issue`: Create a new issue");
    expect(text).not.toContain("`linear.list_teams`");
  });

  it("keeps an authentication-failed server discoverable", async () => {
    const runtime = createRuntimeStub(async () => {
      throw new Error("Authentication required");
    }, ["linear"]);

    const result = await handleSearchAction(
      runtime,
      { action: "search", query: "linear" },
      undefined,
      new CatalogStore(),
    );

    const text = extractResultText(result);
    expect(text).toContain(
      "Found 1 server match and 0 tool matches for 'linear'",
    );
    expect(text).toContain(
      "- `linear` — known MCP server; tool metadata unavailable (authentication required)",
    );
    expect(text).toContain(
      "authenticate `linear` outside this tool with `mcporter auth <server>`",
    );
    expect(text).toContain("not a callable selector");
  });

  it("keeps an offline server discoverable", async () => {
    const runtime = createRuntimeStub(async () => {
      throw new Error("ECONNREFUSED");
    }, ["jira"]);

    const result = await handleSearchAction(
      runtime,
      { action: "search", query: "jira" },
      undefined,
      new CatalogStore(),
    );

    const text = extractResultText(result);
    expect(text).toContain(
      "- `jira` — known MCP server; tool metadata unavailable (offline or unreachable)",
    );
    expect(text).toContain("restore connectivity for `jira`");
  });
});

describe("call output formatting", () => {
  it("classifies text responses", () => {
    const formatted = formatCallOutput("demo.echo", {
      content: [{ type: "text", text: "Hello world" }],
    });

    expect(formatted.kind).toBe("text");
    expect(formatted.text).toContain("### Text response");
  });

  it("classifies structured responses", () => {
    const formatted = formatCallOutput("demo.structured", {
      structuredContent: { ok: true },
    });

    expect(formatted.kind).toBe("structured");
    expect(formatted.text).toContain("### Structured content snippet");
  });

  it("classifies JSON responses", () => {
    const formatted = formatCallOutput("demo.json", {
      content: [{ type: "json", json: { ok: true } }],
    });

    expect(formatted.kind).toBe("json");
    expect(formatted.text).toContain("### JSON payload snippet");
  });

  it("falls back to raw envelopes", () => {
    const formatted = formatCallOutput("demo.raw", { ok: true });

    expect(formatted.kind).toBe("raw");
    expect(formatted.text).toContain("### Raw result envelope snippet");
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

  it("redacts sensitive values in nested argsJson previews", () => {
    expect(
      __test__.formatCallArgsPreview(
        {
          action: "call",
          selector: "demo.echo",
          argsJson:
            '{\n  "headers": {\n    "Authorization": "Bearer top-secret"\n  },\n  "sessionToken": "abc123",\n  "query": "status:open"\n}',
        },
        120,
      ),
    ).toBe(
      'headers={"Authorization":"[redacted]"} sessionToken=[redacted] query=status:open',
    );
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

describe("exposure resolution", () => {
  it("recognizes the four exposure levels", () => {
    expect(__test__.isMcporterExposure("on-demand")).toBe(true);
    expect(__test__.isMcporterExposure("index")).toBe(true);
    expect(__test__.isMcporterExposure("match")).toBe(true);
    expect(__test__.isMcporterExposure("native")).toBe(true);
    expect(__test__.isMcporterExposure("preload")).toBe(false);
  });

  it("prefers a per-server policy", () => {
    expect(
      __test__.resolveServerExposure("index", { exposure: "native" }),
    ).toBe("native");
    expect(__test__.resolveServerExposure("match", undefined)).toBe("match");
  });

  it("matches glob filters with star and question mark", () => {
    expect(__test__.matchesToolPattern("list_issues", "list_*")).toBe(true);
    expect(__test__.matchesToolPattern("get_1", "get_?")).toBe(true);
    expect(__test__.matchesToolPattern("get_12", "get_?")).toBe(false);
  });
});

function extractResultText(
  result: Awaited<ReturnType<typeof handleSearchAction>>,
): string {
  const content = result.content[0];
  return content?.type === "text" ? content.text : "";
}

function demoTool(
  server: string,
  name: string,
  inputSchema?: unknown,
  description = `${server}.${name}`,
): ServerToolInfo {
  return {
    name,
    description,
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
      context?: { isError?: boolean },
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
          context?: { isError?: boolean },
        ) => { render: (width: number) => string[] };
      }
    | undefined;

  mcporterExtension({
    on() {},
    registerCommand() {},
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
