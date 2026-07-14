import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isToolExposed, matchesToolPattern } from "../src/exposure.ts";
import { NativeToolManager, nativeToolName } from "../src/native-tools.ts";
import type { CatalogTool } from "../src/types.ts";

describe("native tool names", () => {
  it("uses the readable common name when it is portable", () => {
    expect(nativeToolName("linear.list_issues")).toBe(
      "mcp__linear__list_issues",
    );
  });

  it("normalizes unusual selectors and appends the specified selector hash", () => {
    const selector = "acme.linear.list issues";
    const expectedHash = createHash("sha256")
      .update(selector)
      .digest("hex")
      .slice(0, 10);
    const name = nativeToolName(selector);

    expect(name).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toMatch(new RegExp(`__${expectedHash}$`, "u"));
  });

  it("keeps long names within the provider-portable limit", () => {
    expect(
      nativeToolName(`${"server".repeat(20)}.${"tool".repeat(20)}`),
    ).toHaveLength(64);
  });
});

describe("native reconciliation", () => {
  it("does not re-register unchanged definitions but refreshes changed schemas", () => {
    const harness = createPiHarness();
    const manager = new NativeToolManager(harness.pi, vi.fn() as never);
    const initial = catalogTool("demo", "echo");

    expect(manager.reconcile([initial])).toEqual([]);
    expect(manager.reconcile([initial])).toEqual([]);
    expect(harness.registerTool).toHaveBeenCalledTimes(1);

    manager.reconcile([
      {
        ...initial,
        inputSchema: {
          type: "object",
          properties: { count: { type: "number" } },
        },
      },
    ]);
    expect(harness.registerTool).toHaveBeenCalledTimes(2);
  });

  it("skips collisions with tools owned elsewhere", () => {
    const harness = createPiHarness(["mcp__demo__echo"]);
    const manager = new NativeToolManager(harness.pi, vi.fn() as never);

    expect(manager.reconcile([catalogTool("demo", "echo")])).toEqual([
      expect.stringContaining("already owned by another tool"),
    ]);
    expect(harness.registerTool).not.toHaveBeenCalled();
  });

  it("skips tools whose input schema cannot be exposed safely", () => {
    const harness = createPiHarness();
    const manager = new NativeToolManager(harness.pi, vi.fn() as never);

    expect(
      manager.reconcile([
        { ...catalogTool("demo", "echo"), inputSchema: { type: "string" } },
      ]),
    ).toEqual([expect.stringContaining("not an object schema")]);
    expect(harness.registerTool).not.toHaveBeenCalled();
  });

  it("deactivates stale definitions while retaining their registrations", () => {
    const harness = createPiHarness();
    const manager = new NativeToolManager(harness.pi, vi.fn() as never);

    manager.reconcile([catalogTool("demo", "echo")]);
    manager.reconcile([]);

    expect(harness.active).not.toContain("mcp__demo__echo");
    expect(manager.getStatus().registered).toEqual(["mcp__demo__echo"]);
  });

  it("remembers a manual disable across temporary discovery gaps", () => {
    const harness = createPiHarness();
    const manager = new NativeToolManager(harness.pi, vi.fn() as never);
    const tool = catalogTool("demo", "echo");

    manager.reconcile([tool]);
    harness.active = harness.active.filter(
      (name) => name !== "mcp__demo__echo",
    );
    manager.reconcile([]);
    manager.reconcile([tool]);

    expect(harness.active).not.toContain("mcp__demo__echo");
  });
});

describe("tool filters", () => {
  const policy = {
    exposure: "native" as const,
    includeTools: ["list_*", "get_?"],
    excludeTools: ["*_private"],
  };

  it("supports star and question-mark globs with exclusion precedence", () => {
    expect(matchesToolPattern("list_issues", "list_*")).toBe(true);
    expect(isToolExposed("list_issues", policy)).toBe(true);
    expect(isToolExposed("get_1", policy)).toBe(true);
    expect(isToolExposed("get_12", policy)).toBe(false);
    expect(isToolExposed("list_private", policy)).toBe(false);
  });
});

function catalogTool(server: string, tool: string): CatalogTool {
  return {
    server,
    tool,
    selector: `${server}.${tool}`,
    description: `Call ${tool}`,
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
    },
  };
}

function createPiHarness(existingNames: string[] = []) {
  const tools = new Map(
    existingNames.map((name) => [
      name,
      {
        name,
        description: "existing",
        parameters: { type: "object", properties: {} },
      },
    ]),
  );
  const harness = {
    active: [...existingNames],
    registerTool: vi.fn((tool: any) => {
      tools.set(tool.name, tool);
      if (!harness.active.includes(tool.name)) harness.active.push(tool.name);
    }),
    pi: undefined as any,
  };
  harness.pi = {
    getActiveTools: () => [...harness.active],
    getAllTools: () =>
      [...tools.values()].map((tool) => ({
        ...tool,
        sourceInfo: {
          path: "<test>",
          source: "extension",
          scope: "temporary",
          origin: "top-level",
        },
      })),
    registerTool: harness.registerTool,
    setActiveTools: (names: string[]) => {
      harness.active = [...names];
    },
  };
  return harness;
}
