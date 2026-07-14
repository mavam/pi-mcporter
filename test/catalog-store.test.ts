import { describe, expect, it, vi } from "vitest";
import type { Runtime, ServerToolInfo } from "mcporter";
import { CatalogService } from "../src/catalog-service.ts";
import { CatalogStore } from "../src/catalog-store.ts";
import { CATALOG_TTL_MS } from "../src/constants.ts";

describe("CatalogStore", () => {
  it("coalesces concurrent schema reads", async () => {
    let resolveTools: ((tools: ServerToolInfo[]) => void) | undefined;
    const listTools = vi.fn(
      () =>
        new Promise<ServerToolInfo[]>((resolve) => {
          resolveTools = resolve;
        }),
    );
    const runtime = createRuntimeStub(listTools);
    const store = new CatalogStore();

    const first = store.getServerCatalogWithSchema(runtime, "alpha");
    const second = store.startServerCatalogWithSchema(runtime, "alpha");
    expect(listTools).toHaveBeenCalledOnce();
    resolveTools?.([schemaTool("alpha", "lookup")]);

    await expect(first).resolves.toEqual([
      expect.objectContaining({ selector: "alpha.lookup" }),
    ]);
    await expect(second).resolves.toEqual([
      expect.objectContaining({ selector: "alpha.lookup" }),
    ]);
  });

  it("expires aggregate snapshots with their reused server entries", async () => {
    vi.useFakeTimers();

    try {
      const store = new CatalogStore();
      const alphaResults = ["initial_lookup", "fresh_lookup"];
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
        expect.objectContaining({ selector: "alpha.initial_lookup" }),
      ]);

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

  it("does not restore entries from loads that finish after clear", async () => {
    const store = new CatalogStore();
    let resolveOldTools: ((tools: ServerToolInfo[]) => void) | undefined;
    const oldRuntime = createRuntimeStub(
      () =>
        new Promise<ServerToolInfo[]>((resolve) => {
          resolveOldTools = resolve;
        }),
    );
    const newRuntime = createRuntimeStub(async () => [
      demoTool("alpha", "new_lookup"),
    ]);

    const oldLoad = store.getBasicCatalog(oldRuntime);
    await vi.waitFor(() => {
      expect(resolveOldTools).toBeTypeOf("function");
    });
    store.clear();
    await store.getBasicCatalog(newRuntime);

    resolveOldTools?.([demoTool("alpha", "old_lookup")]);
    await oldLoad;
    expect(store.getCachedToolsForServer("alpha")).toEqual([
      expect.objectContaining({ selector: "alpha.new_lookup" }),
    ]);
  });
});

describe("CatalogService exposure discovery", () => {
  it("shares one overall cold-start deadline while discovery continues", async () => {
    const resolvers = new Map<string, (tools: ServerToolInfo[]) => void>();
    const listTools = vi.fn(
      (server: string) =>
        new Promise<ServerToolInfo[]>((resolve) => {
          resolvers.set(server, resolve);
        }),
    );
    const runtime = createRuntimeStub(listTools, ["alpha", "beta"]);
    const service = new CatalogService();

    const first = await service.prepareSchemaCatalogs(
      runtime,
      ["alpha", "beta"],
      5,
    );
    expect(first.byServer.size).toBe(0);
    expect(first.pendingServers).toEqual(["alpha", "beta"]);
    expect(listTools).toHaveBeenCalledTimes(2);

    resolvers.get("alpha")?.([schemaTool("alpha", "lookup")]);
    resolvers.get("beta")?.([schemaTool("beta", "lookup")]);
    await vi.waitFor(() => {
      expect(
        service.store.getCachedToolsForServer("alpha", {
          requireSchema: true,
        }),
      ).toHaveLength(1);
      expect(
        service.store.getCachedToolsForServer("beta", {
          requireSchema: true,
        }),
      ).toHaveLength(1);
    });

    const second = await service.prepareSchemaCatalogs(
      runtime,
      ["alpha", "beta"],
      5,
    );
    expect(second.byServer.get("alpha")).toEqual([
      expect.objectContaining({ selector: "alpha.lookup" }),
    ]);
    expect(second.byServer.get("beta")).toEqual([
      expect.objectContaining({ selector: "beta.lookup" }),
    ]);
    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it("serves expired schemas immediately while refreshing them", async () => {
    let now = 1_000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    let resolveRefresh: ((tools: ServerToolInfo[]) => void) | undefined;
    const listTools = vi
      .fn<Runtime["listTools"]>()
      .mockResolvedValueOnce([schemaTool("alpha", "old_lookup")])
      .mockImplementationOnce(
        () =>
          new Promise<ServerToolInfo[]>((resolve) => {
            resolveRefresh = resolve;
          }),
      );
    const runtime = createRuntimeStub(listTools);
    const service = new CatalogService();

    try {
      await service.prepareSchemaCatalogs(runtime, ["alpha"], 100);
      now += CATALOG_TTL_MS + 1;

      const stale = await service.prepareSchemaCatalogs(
        runtime,
        ["alpha"],
        100,
      );
      expect(stale.staleServers).toEqual(["alpha"]);
      expect(stale.byServer.get("alpha")).toEqual([
        expect.objectContaining({ selector: "alpha.old_lookup" }),
      ]);
      expect(listTools).toHaveBeenCalledTimes(2);

      resolveRefresh?.([schemaTool("alpha", "new_lookup")]);
      await vi.waitFor(() => {
        expect(
          service.store.getCachedToolsForServer("alpha", {
            requireSchema: true,
          }),
        ).toEqual([expect.objectContaining({ selector: "alpha.new_lookup" })]);
      });
    } finally {
      dateSpy.mockRestore();
    }
  });

  it("records discovery failures and clears them after a successful retry", async () => {
    const listTools = vi
      .fn<Runtime["listTools"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([schemaTool("alpha", "lookup")]);
    const runtime = createRuntimeStub(listTools);
    const service = new CatalogService();

    const failed = await service.prepareSchemaCatalogs(runtime, ["alpha"], 100);
    expect(failed.warnings).toEqual(["alpha: offline"]);
    expect(service.getServerStatus("alpha")).toEqual({
      error: "offline",
      state: "cold",
    });

    const recovered = await service.prepareSchemaCatalogs(
      runtime,
      ["alpha"],
      100,
    );
    expect(recovered.warnings).toEqual([]);
    expect(service.getServerStatus("alpha")).toEqual({ state: "fresh" });
  });
});

function demoTool(server: string, name: string): ServerToolInfo {
  return {
    name,
    description: `${server}.${name}`,
  };
}

function schemaTool(server: string, name: string): ServerToolInfo {
  return {
    ...demoTool(server, name),
    inputSchema: { type: "object", properties: {} },
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
