import { describe, expect, it } from "vitest";
import mcporterExtension, { __test__ } from "../src/index.ts";
import { formatCallOutput, summarizeCallOutput } from "../src/output.ts";

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
    );

    expect(rendered).toContain("mcporter call linear.list_issues");
    expect(rendered).toContain('{"team":"PI","limit":10,"state":"Todo"}');
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
      __test__.formatCallArgsPreview({
        action: "call",
        selector: "demo.echo",
        argsJson: '{\n  "team": "PI",\n  "limit": 10\n}',
      }),
    ).toBe('{"team":"PI","limit":10}');
  });

  it("preserves whitespace inside string literals", () => {
    expect(
      __test__.formatCallArgsPreview({
        action: "call",
        selector: "demo.echo",
        argsJson:
          '{\n  "query": "  keep   internal spaces  ",\n  "regex": "^foo  bar$"\n}',
      }),
    ).toBe('{"query":"  keep   internal spaces  ","r...');
  });

  it("truncates long args previews", () => {
    expect(
      __test__.formatCallArgsPreview({
        action: "call",
        selector: "demo.echo",
        args: {
          query: "this is a deliberately long string that should be truncated",
        },
      }),
    ).toBe('{"query":"this is a deliberately long st...');
  });
});

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

function renderComponentText(component: {
  render: (width: number) => string[];
}): string {
  return component.render(120).join("\n").trim();
}
