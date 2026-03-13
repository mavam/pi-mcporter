import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Runtime, ServerToolInfo } from "mcporter";
import { createMcporterController } from "../src/bootstrap.ts";
import { CatalogService } from "../src/catalog-service.ts";
import { CatalogStore } from "../src/catalog-store.ts";
import { CATALOG_TTL_MS } from "../src/constants.ts";

describe("createMcporterController", () => {
  it("closes runtimes that finish creating after shutdown", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const previousHome = process.env.HOME;
    const runtime = createRuntimeStub();
    let resolveRuntime: ((runtime: Runtime) => void) | undefined;
    const createRuntimeFn = vi.fn().mockImplementation(
      () =>
        new Promise<Runtime>((resolve) => {
          resolveRuntime = resolve;
        }),
    );
    process.env.HOME = homeDirectory;

    try {
      const controller = createMcporterController({} as never, {
        createRuntimeFn: createRuntimeFn as never,
        packageVersion: "1.0.0",
      });

      const runtimePromise = controller.ensureRuntime();
      await vi.waitFor(() => {
        expect(createRuntimeFn).toHaveBeenCalledTimes(1);
      });
      await controller.shutdown();

      resolveRuntime?.(runtime);
      await expect(runtimePromise).rejects.toThrow("Stale runtime session");
      expect(runtime.close).toHaveBeenCalledTimes(1);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("does not create a runtime when prompt preloading is disabled", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const previousHome = process.env.HOME;
    const createRuntimeFn = vi.fn();
    process.env.HOME = homeDirectory;

    try {
      const controller = createMcporterController({} as never, {
        createRuntimeFn: createRuntimeFn as never,
        packageVersion: "1.0.0",
      });

      await expect(
        controller.buildSystemPromptAppend(),
      ).resolves.toBeUndefined();
      expect(createRuntimeFn).not.toHaveBeenCalled();
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("retries prompt preloading after transient failures", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;
    let attempts = 0;
    const runtime = createRuntimeStub(async () => {
      attempts += 1;
      if (attempts === 1) {
        await delay(30);
      }
      return [demoTool("alpha", "lookup")];
    }, ["alpha"]);
    process.env.HOME = homeDirectory;
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "preload" }), "utf8");

    try {
      const controller = createMcporterController({} as never, {
        catalogService: new CatalogService(
          new CatalogStore({ listTimeoutMs: 10 }),
        ),
        createRuntimeFn: vi.fn().mockResolvedValue(runtime) as never,
        packageVersion: "1.0.0",
      });

      await expect(
        controller.buildSystemPromptAppend(),
      ).resolves.toBeUndefined();
      await expect(controller.buildSystemPromptAppend()).resolves.toContain(
        "alpha.lookup",
      );
      expect(attempts).toBe(2);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("refreshes prompt catalogs after TTL expiry", async () => {
    vi.useFakeTimers();

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;
    let attempts = 0;
    const runtime = createRuntimeStub(async () => {
      attempts += 1;
      return [
        demoTool("alpha", attempts === 1 ? "legacy_lookup" : "fresh_lookup"),
      ];
    }, ["alpha"]);
    process.env.HOME = homeDirectory;
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "preload" }), "utf8");

    try {
      const controller = createMcporterController({} as never, {
        createRuntimeFn: vi.fn().mockResolvedValue(runtime) as never,
        packageVersion: "1.0.0",
      });

      await expect(controller.buildSystemPromptAppend()).resolves.toContain(
        "alpha.legacy_lookup",
      );
      await expect(controller.buildSystemPromptAppend()).resolves.toContain(
        "alpha.legacy_lookup",
      );
      expect(attempts).toBe(1);

      vi.advanceTimersByTime(CATALOG_TTL_MS + 1);

      await expect(controller.buildSystemPromptAppend()).resolves.toContain(
        "alpha.fresh_lookup",
      );
      expect(attempts).toBe(2);
    } finally {
      vi.useRealTimers();

      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      await rm(homeDirectory, { recursive: true, force: true });
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
  listTools: Runtime["listTools"] = async () => [],
  servers: string[] = [],
): Runtime & { close: ReturnType<typeof vi.fn> } {
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
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Runtime & { close: ReturnType<typeof vi.fn> };
}
