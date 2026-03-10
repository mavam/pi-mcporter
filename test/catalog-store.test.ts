import { describe, expect, it } from "vitest";
import type { Runtime, ServerToolInfo } from "mcporter";
import { CatalogStore } from "../src/catalog-store.ts";
import { preloadCatalogForMode } from "../src/startup.ts";

describe("CatalogStore preload timeouts", () => {
  it("does not apply preload timeouts to interactive schema reads", async () => {
    const store = new CatalogStore({ listTimeoutMs: 10 });
    const runtime = createRuntimeStub(async () => {
      await delay(30);
      return [demoTool("alpha", "lookup")];
    });

    await expect(
      store.getServerCatalogWithSchema(runtime, "alpha"),
    ).resolves.toEqual([
      expect.objectContaining({
        selector: "alpha.lookup",
      }),
    ]);
  });

  it("still applies the timeout while preloading schema reads", async () => {
    const store = new CatalogStore({ listTimeoutMs: 10 });
    const runtime = createRuntimeStub(async () => {
      await delay(30);
      return [demoTool("alpha", "lookup")];
    });

    await expect(
      store.preloadServerCatalogWithSchema(runtime, "alpha"),
    ).rejects.toThrow("Timed out loading MCP tool catalog for 'alpha'");
  });

  it("reuses preloaded server results and warnings for search snapshots", async () => {
    const store = new CatalogStore({ listTimeoutMs: 10 });
    const listCalls = new Map<string, number>();
    const runtime = createRuntimeStub(
      async (server) => {
        listCalls.set(server, (listCalls.get(server) ?? 0) + 1);
        if (server === "beta") {
          await delay(30);
        }
        return [demoTool(server, "lookup")];
      },
      ["alpha", "beta"],
    );

    const summary = await preloadCatalogForMode(runtime, store, "preload");
    expect(summary.warmedServers).toEqual(["alpha"]);
    expect(summary.warnings).toEqual([
      expect.stringContaining("beta: Timed out loading MCP tool catalog"),
    ]);

    const catalog = await store.getBasicCatalog(runtime);

    expect(catalog.tools.map((tool) => tool.selector)).toEqual(["alpha.lookup"]);
    expect(catalog.byServer.get("alpha")).toEqual([
      expect.objectContaining({ selector: "alpha.lookup" }),
    ]);
    expect(catalog.byServer.get("beta")).toEqual([]);
    expect(catalog.warnings).toEqual([
      expect.stringContaining("beta: Timed out loading MCP tool catalog"),
    ]);
    expect(listCalls.get("alpha")).toBe(1);
    expect(listCalls.get("beta")).toBe(1);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function demoTool(server: string, name: string): ServerToolInfo {
  return {
    name,
    description: `${server}.${name}`,
  };
}

function createRuntimeStub(
  listTools: Runtime["listTools"],
  servers: string[] = ["alpha"],
): Runtime {
  return {
    listServers: () => servers,
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
