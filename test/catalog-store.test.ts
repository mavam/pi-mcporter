import { describe, expect, it, vi } from "vitest";
import type { Runtime, ServerToolInfo } from "mcporter";
import { CatalogStore } from "../src/catalog-store.ts";
import { CATALOG_TTL_MS } from "../src/constants.ts";
import { preloadCatalog } from "../src/startup.ts";

describe("CatalogStore preload timeouts", () => {
  it("does not reuse in-flight preload schema requests for interactive reads", async () => {
    const store = new CatalogStore({ listTimeoutMs: 10 });
    let schemaCalls = 0;
    const runtime = createRuntimeStub(async (_server, options) => {
      schemaCalls += 1;
      await delay(options?.includeSchema ? 30 : 0);
      return [demoTool("alpha", "lookup")];
    });

    const preloadResult = store
      .preloadServerCatalogWithSchema(runtime, "alpha")
      .then(
        () => ({ ok: true as const }),
        (error) => ({ ok: false as const, error }),
      );
    await delay(5);

    await expect(
      store.getServerCatalogWithSchema(runtime, "alpha"),
    ).resolves.toEqual([
      expect.objectContaining({
        selector: "alpha.lookup",
      }),
    ]);
    await expect(preloadResult).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringContaining(
          "Timed out loading MCP tool catalog for 'alpha'",
        ),
      }),
    });
    expect(schemaCalls).toBe(2);
  });

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

  it("does not reuse in-flight preload basic requests for interactive reads", async () => {
    const store = new CatalogStore({ listTimeoutMs: 10 });
    let basicCalls = 0;
    const runtime = createRuntimeStub(async (_server, options) => {
      basicCalls += 1;
      await delay(options?.includeSchema ? 0 : 30);
      return [demoTool("alpha", "lookup")];
    });

    const preloadResult = store
      .preloadServerCatalogBasic(runtime, "alpha")
      .then(
        () => ({ ok: true as const }),
        (error) => ({ ok: false as const, error }),
      );
    await delay(5);

    await expect(
      store.getServerCatalogBasic(runtime, "alpha"),
    ).resolves.toEqual([expect.objectContaining({ selector: "alpha.lookup" })]);
    await expect(preloadResult).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringContaining(
          "Timed out loading MCP tool catalog for 'alpha'",
        ),
      }),
    });
    expect(basicCalls).toBe(2);
  });

  it("falls back to basic discovery after schema preload failures", async () => {
    const store = new CatalogStore({ listTimeoutMs: 10 });
    const includeSchemaCalls: boolean[] = [];
    const runtime = createRuntimeStub(async (_server, options) => {
      includeSchemaCalls.push(Boolean(options?.includeSchema));
      if (options?.includeSchema) {
        throw new Error("schema load failed");
      }
      return [demoTool("alpha", "lookup")];
    });

    await expect(
      store.preloadServerCatalogWithSchema(runtime, "alpha"),
    ).rejects.toThrow("schema load failed");

    const catalog = await store.getBasicCatalog(runtime);

    expect(catalog.tools).toEqual([
      expect.objectContaining({ selector: "alpha.lookup" }),
    ]);
    expect(catalog.byServer.get("alpha")).toEqual([
      expect.objectContaining({ selector: "alpha.lookup" }),
    ]);
    expect(catalog.warnings).toEqual([]);
    expect(includeSchemaCalls).toEqual([true, false]);
  });

  it("retries failed preload servers when building search snapshots", async () => {
    const store = new CatalogStore({ listTimeoutMs: 10 });
    const listCalls = new Map<string, number>();
    const runtime = createRuntimeStub(
      async (server) => {
        listCalls.set(server, (listCalls.get(server) ?? 0) + 1);
        if (server === "beta" && listCalls.get(server) === 1) {
          await delay(30);
        }
        return [demoTool(server, "lookup")];
      },
      ["alpha", "beta"],
    );

    const summary = await preloadCatalog(runtime, store);
    expect(summary.warmedServers).toEqual(["alpha"]);
    expect(summary.warnings).toEqual([
      expect.stringContaining("beta: Timed out loading MCP tool catalog"),
    ]);

    const catalog = await store.getBasicCatalog(runtime);

    expect(catalog.tools.map((tool) => tool.selector)).toEqual([
      "alpha.lookup",
      "beta.lookup",
    ]);
    expect(catalog.byServer.get("alpha")).toEqual([
      expect.objectContaining({ selector: "alpha.lookup" }),
    ]);
    expect(catalog.byServer.get("beta")).toEqual([
      expect.objectContaining({ selector: "beta.lookup" }),
    ]);
    expect(catalog.warnings).toEqual([]);
    expect(listCalls.get("alpha")).toBe(1);
    expect(listCalls.get("beta")).toBe(2);
  });

  it("expires aggregate snapshots when a reused per-server cache entry expires", async () => {
    vi.useFakeTimers();

    try {
      const store = new CatalogStore();
      const alphaResults = ["legacy_lookup", "fresh_lookup"];
      const listCalls = new Map<string, number>();
      const runtime = createRuntimeStub(
        async (server) => {
          listCalls.set(server, (listCalls.get(server) ?? 0) + 1);
          if (server === "alpha") {
            return [
              demoTool(
                server,
                alphaResults[(listCalls.get(server) ?? 1) - 1] ??
                  "fresh_lookup",
              ),
            ];
          }
          return [demoTool(server, "lookup")];
        },
        ["alpha", "beta"],
      );

      await store.getServerCatalogBasic(runtime, "alpha");
      vi.advanceTimersByTime(CATALOG_TTL_MS - 1);

      const firstSnapshot = await store.getBasicCatalog(runtime);
      expect(firstSnapshot.byServer.get("alpha")).toEqual([
        expect.objectContaining({ selector: "alpha.legacy_lookup" }),
      ]);
      expect(listCalls.get("alpha")).toBe(1);
      expect(listCalls.get("beta")).toBe(1);

      vi.advanceTimersByTime(2);

      const secondSnapshot = await store.getBasicCatalog(runtime);
      expect(secondSnapshot.byServer.get("alpha")).toEqual([
        expect.objectContaining({ selector: "alpha.fresh_lookup" }),
      ]);
      expect(listCalls.get("alpha")).toBe(2);
      expect(listCalls.get("beta")).toBe(1);
    } finally {
      vi.useRealTimers();
    }
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
