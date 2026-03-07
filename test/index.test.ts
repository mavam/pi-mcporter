import { describe, expect, it } from "vitest";
import { __test__ } from "../src/index.ts";

const {
  parseCallArgs,
  parseSelector,
  rankTools,
  resolveCallTimeoutFromInputs,
  suggest,
} = __test__;

type ParseCallArgsParams = Parameters<typeof parseCallArgs>[0];
type CatalogTool = Parameters<typeof rankTools>[0][number];

function asParams(value: Partial<ParseCallArgsParams>): ParseCallArgsParams {
  return value as ParseCallArgsParams;
}

function tool(server: string, name: string, description?: string): CatalogTool {
  return {
    server,
    tool: name,
    selector: `${server}.${name}`,
    description,
  };
}

describe("parseSelector", () => {
  it("parses valid selector with dotted server names", () => {
    expect(parseSelector("acme.linear.list_issues")).toEqual({
      raw: "acme.linear.list_issues",
      server: "acme.linear",
      tool: "list_issues",
    });
  });

  it("rejects missing selector", () => {
    const result = parseSelector(undefined);
    expect("error" in result && result.error).toContain("selector is required");
  });

  it("rejects malformed selector", () => {
    const result = parseSelector("linear");
    expect("error" in result && result.error).toContain(
      "Expected 'server.tool'",
    );
  });
});

describe("parseCallArgs", () => {
  it("accepts plain-object args", () => {
    expect(parseCallArgs(asParams({ args: { limit: 10 } }))).toEqual({
      args: { limit: 10 },
    });
  });

  it("accepts argsJson object", () => {
    expect(parseCallArgs(asParams({ argsJson: '{"q":"hello"}' }))).toEqual({
      args: { q: "hello" },
    });
  });

  it("enforces args/argsJson mutual exclusivity even for empty args", () => {
    const result = parseCallArgs(asParams({ args: {}, argsJson: "{}" }));
    expect("error" in result && result.error).toContain(
      "Provide either args or argsJson, not both.",
    );
  });

  it("rejects non-object argsJson payload", () => {
    const result = parseCallArgs(asParams({ argsJson: "[1,2,3]" }));
    expect("error" in result && result.error).toContain(
      "argsJson must decode to a JSON object.",
    );
  });

  it("rejects non-object args", () => {
    const result = parseCallArgs(
      asParams({ args: "bad-shape" as unknown as Record<string, unknown> }),
    );
    expect("error" in result && result.error).toContain(
      "args must be an object when provided.",
    );
  });
});

describe("resolveCallTimeoutFromInputs", () => {
  it("prefers explicit override", () => {
    expect(resolveCallTimeoutFromInputs(1200, "5000")).toBe(1200);
  });

  it("falls back to flag value when override is invalid", () => {
    expect(resolveCallTimeoutFromInputs(0, "45000")).toBe(45000);
  });

  it("uses default timeout when both inputs are invalid", () => {
    expect(resolveCallTimeoutFromInputs(undefined, "wat")).toBe(30_000);
  });
});

describe("suggest and rankTools", () => {
  const tools: CatalogTool[] = [
    tool("linear", "list_issues", "List issues by status"),
    tool("slack", "post_message", "Post a channel message"),
    tool("notion", "search_pages", "Search knowledge base pages"),
  ];

  it("returns likely suggestions", () => {
    expect(suggest("linar", ["linear", "slack"])).toContain("linear");
  });

  it("ranks exact selector highest", () => {
    const ranked = rankTools(tools, "linear.list_issues");
    expect(ranked[0]?.selector).toBe("linear.list_issues");
  });

  it("returns no matches for unrelated query", () => {
    expect(rankTools(tools, "kubernetes deploy")).toEqual([]);
  });
});
