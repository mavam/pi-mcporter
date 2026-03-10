import { describe, expect, it } from "vitest";
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
    const definitions: Array<{ name: string; parameters: unknown }> = [];

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
    });
  });

  it("suffixes hoisted names when Pi already exposes the generated name", () => {
    const definitions: Array<{ name: string }> = [];
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
    );

    expect(created).toEqual(["mcp__linear__list_issues__2"]);
    expect(definitions.map((definition) => definition.name)).toEqual([
      "mcp__linear__list_issues__2",
    ]);
  });
});

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
  definitions: Array<{ name: string; parameters?: unknown }>,
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
      const { name, parameters } = definition as {
        name: string;
        parameters?: unknown;
      };
      definitions.push({ name, parameters });
    },
  } as never;
}
