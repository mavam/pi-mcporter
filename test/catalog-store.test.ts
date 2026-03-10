import { describe, expect, it } from "vitest";
import type { Runtime, ServerToolInfo } from "mcporter";
import { CatalogStore } from "../src/catalog-store.ts";

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

function createRuntimeStub(listTools: Runtime["listTools"]): Runtime {
  return {
    listServers: () => ["alpha"],
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
