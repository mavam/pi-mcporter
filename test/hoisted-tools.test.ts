import { describe, expect, it, vi } from "vitest";
import { CatalogStore } from "../src/catalog-store.ts";
import { registerHoistedTools } from "../src/hoisted-tools.ts";
import type { CatalogTool } from "../src/types.ts";

describe("registerHoistedTools", () => {
  it("keeps hoisted tool names unique across incremental registrations", () => {
    const definitions: Array<{ name: string }> = [];
    const registeredSelectors = new Map<string, string>();
    const registeredNames = new Set<string>();

    const first = registerHoistedTools(
      createPiStub(definitions),
      async () => {
        throw new Error("not implemented");
      },
      new CatalogStore(),
      [demoTool("alpha", "foo-bar")],
      () => 30_000,
      registeredSelectors,
      registeredNames,
    );

    const second = registerHoistedTools(
      createPiStub(definitions),
      async () => {
        throw new Error("not implemented");
      },
      new CatalogStore(),
      [demoTool("alpha", "foo_bar")],
      () => 30_000,
      registeredSelectors,
      registeredNames,
    );

    expect(first).toEqual(["mcp__alpha__foo_bar"]);
    expect(second).toEqual(["mcp__alpha__foo_bar__2"]);
    expect(definitions.map((definition) => definition.name)).toEqual([
      "mcp__alpha__foo_bar",
      "mcp__alpha__foo_bar__2",
    ]);
  });

  it("preserves hoisted root reference schemas", () => {
    const definitions: HoistedDefinitionRecord[] = [];

    registerHoistedTools(
      createPiStub(definitions),
      async () => {
        throw new Error("not implemented");
      },
      new CatalogStore(),
      [
        demoTool("alpha", "lookup", {
          $ref: "#/$defs/Input",
          $defs: {
            Input: {
              type: "object",
              properties: {
                slug: { type: "string" },
              },
              required: ["slug"],
            },
          },
        }),
      ],
      () => 30_000,
      new Map<string, string>(),
      new Set<string>(),
    );

    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.parameters).toMatchObject({
      $ref: "#/$defs/Input",
      $defs: {
        Input: {
          type: "object",
          required: ["slug"],
        },
      },
      allOf: [
        {
          properties: {
            timeoutMs: {
              type: "integer",
            },
          },
        },
      ],
    });
  });

  it("suffixes hoisted names when Pi already exposes the generated name", () => {
    const definitions: HoistedDefinitionRecord[] = [];
    const existingToolNames = ["mcp__linear__list_issues"];

    const created = registerHoistedTools(
      createPiStub(definitions, existingToolNames),
      async () => {
        throw new Error("not implemented");
      },
      new CatalogStore(),
      [demoTool("linear", "list_issues")],
      () => 30_000,
      new Map<string, string>(),
      new Set<string>(),
      existingToolNames,
    );

    expect(created).toEqual(["mcp__linear__list_issues__2"]);
    expect(definitions.map((definition) => definition.name)).toEqual([
      "mcp__linear__list_issues__2",
    ]);
  });

  it("refreshes existing hoisted names for selectors registered in a prior session", () => {
    const definitions: HoistedDefinitionRecord[] = [
      { name: "mcp__alpha__lookup", parameters: { type: "string" } },
    ];
    const registeredSelectors = new Map([
      ["alpha.lookup", "mcp__alpha__lookup"],
    ]);
    const registeredNames = new Set(["mcp__alpha__lookup"]);

    const active = registerHoistedTools(
      createPiStub(definitions, ["mcp__alpha__lookup"]),
      async () => {
        throw new Error("not implemented");
      },
      new CatalogStore(),
      [demoTool("alpha", "lookup")],
      () => 30_000,
      registeredSelectors,
      registeredNames,
    );

    expect(active).toEqual(["mcp__alpha__lookup"]);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      name: "mcp__alpha__lookup",
      parameters: {
        type: "object",
        additionalProperties: true,
        description: "Arguments object for 'alpha.lookup'.",
        properties: {
          timeoutMs: {
            type: "integer",
          },
        },
      },
    });
  });

  it("exposes timeoutMs and removes it from forwarded MCP args", async () => {
    const definitions: HoistedDefinitionRecord[] = [];
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "done" }],
    });

    registerHoistedTools(
      createPiStub(definitions),
      async () =>
        ({
          listServers: () => ["alpha"],
          callTool,
        }) as never,
      new CatalogStore(),
      [
        demoTool("alpha", "lookup", {
          type: "object",
          properties: {
            slug: { type: "string" },
          },
          required: ["slug"],
        }),
      ],
      (override) => override ?? 30_000,
      new Map<string, string>(),
      new Set<string>(),
    );

    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.parameters).toMatchObject({
      type: "object",
      properties: {
        slug: { type: "string" },
        timeoutMs: { type: "integer" },
      },
      required: ["slug"],
    });

    await definitions[0]?.execute?.("call-1", {
      slug: "abc",
      timeoutMs: 45_000,
    });

    expect(callTool).toHaveBeenCalledWith("alpha", "lookup", {
      args: { slug: "abc" },
      timeoutMs: 45_000,
    });
  });
});

type HoistedDefinitionRecord = {
  execute?: (toolCallId: string, rawParams: unknown) => Promise<unknown>;
  name: string;
  parameters?: unknown;
};

function demoTool(
  server: string,
  name: string,
  inputSchema?: unknown,
): CatalogTool {
  return {
    server,
    tool: name,
    selector: `${server}.${name}`,
    description: `${server}.${name}`,
    inputSchema,
  };
}

function createPiStub(
  definitions: HoistedDefinitionRecord[],
  existingToolNames: string[] = [],
) {
  return {
    getAllTools() {
      return [
        ...existingToolNames,
        ...definitions.map((definition) => definition.name),
      ].map((name) => ({ name, description: name }));
    },
    registerTool(definition: unknown) {
      const { execute, name, parameters } = definition as HoistedDefinitionRecord;
      const existingIndex = definitions.findIndex(
        (definition) => definition.name === name,
      );
      if (existingIndex >= 0) {
        definitions[existingIndex] = { execute, name, parameters };
        return;
      }
      definitions.push({ execute, name, parameters });
    },
  } as never;
}
