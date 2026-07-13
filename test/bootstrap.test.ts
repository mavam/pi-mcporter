import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Runtime, ServerToolInfo } from "mcporter";
import { createMcporterController } from "../src/bootstrap.ts";

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

      const runtimePromise = controller.ensureRuntime("/repo");
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

  it("does not create a runtime in lazy mode", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const previousHome = process.env.HOME;
    const createRuntimeFn = vi.fn();
    process.env.HOME = homeDirectory;
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      join(settingsDirectory, "mcporter.json"),
      JSON.stringify({ mode: "lazy" }),
      "utf8",
    );

    try {
      const controller = createMcporterController({} as never, {
        createRuntimeFn: createRuntimeFn as never,
        packageVersion: "1.0.0",
      });

      await expect(
        controller.buildSystemPromptAppend("/repo"),
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

  it("loads call timeout settings even when no prompt orchestration ran", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const previousHome = process.env.HOME;
    process.env.HOME = homeDirectory;
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      join(settingsDirectory, "mcporter.json"),
      JSON.stringify({ timeoutMs: 45_000 }),
      "utf8",
    );

    try {
      const controller = createMcporterController({} as never, {
        createRuntimeFn: vi
          .fn()
          .mockResolvedValue(createRuntimeStub()) as never,
        packageVersion: "1.0.0",
      });

      await expect(controller.resolveCallTimeout()).resolves.toBe(45_000);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("falls back to the default call timeout when pi settings are malformed", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const previousHome = process.env.HOME;
    process.env.HOME = homeDirectory;
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(join(settingsDirectory, "mcporter.json"), "{", "utf8");

    try {
      const controller = createMcporterController({} as never, {
        createRuntimeFn: vi
          .fn()
          .mockResolvedValue(createRuntimeStub()) as never,
        packageVersion: "1.0.0",
      });

      await expect(controller.resolveCallTimeout()).resolves.toBe(30_000);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("delegates MCPorter config resolution to mcporter", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const previousHome = process.env.HOME;
    const previousConfig = process.env.MCPORTER_CONFIG;
    const runtime = createRuntimeStub(undefined, ["demo"]);
    const createRuntimeFn = vi.fn().mockResolvedValue(runtime);
    process.env.HOME = homeDirectory;
    process.env.MCPORTER_CONFIG = "/env/mcporter.json";
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      join(settingsDirectory, "mcporter.json"),
      JSON.stringify({ configPath: "/ignored/by/pi-mcporter.json" }),
      "utf8",
    );

    try {
      const controller = createMcporterController({} as never, {
        createRuntimeFn: createRuntimeFn as never,
        packageVersion: "1.0.0",
      });

      await expect(controller.ensureRuntime("/repo")).resolves.toBe(runtime);
      expect(createRuntimeFn).toHaveBeenCalledWith({
        rootDir: "/repo",
        clientInfo: { name: "pi-mcporter", version: "1.0.0" },
      });
      expect(createRuntimeFn.mock.calls[0]?.[0]).not.toHaveProperty(
        "configPath",
      );
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousConfig === undefined) {
        delete process.env.MCPORTER_CONFIG;
      } else {
        process.env.MCPORTER_CONFIG = previousConfig;
      }

      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("recreates the runtime when the pi cwd changes", async () => {
    const firstRuntime = createRuntimeStub();
    const secondRuntime = createRuntimeStub();
    const createRuntimeFn = vi
      .fn()
      .mockResolvedValueOnce(firstRuntime)
      .mockResolvedValueOnce(secondRuntime);
    const controller = createMcporterController({} as never, {
      createRuntimeFn: createRuntimeFn as never,
      packageVersion: "1.0.0",
    });

    await expect(controller.ensureRuntime("/repo-a")).resolves.toBe(
      firstRuntime,
    );
    await expect(controller.ensureRuntime("/repo-b")).resolves.toBe(
      secondRuntime,
    );

    expect(firstRuntime.close).toHaveBeenCalledTimes(1);
    expect(createRuntimeFn).toHaveBeenNthCalledWith(1, {
      rootDir: "/repo-a",
      clientInfo: { name: "pi-mcporter", version: "1.0.0" },
    });
    expect(createRuntimeFn).toHaveBeenNthCalledWith(2, {
      rootDir: "/repo-b",
      clientInfo: { name: "pi-mcporter", version: "1.0.0" },
    });
  });

  it("clears the catalog when the pi cwd changes", async () => {
    const firstRuntime = createRuntimeStub(
      async () => [demoTool("alpha", "repo_a_lookup")],
      ["alpha"],
    );
    const secondRuntime = createRuntimeStub(
      async () => [demoTool("alpha", "repo_b_lookup")],
      ["alpha"],
    );
    const createRuntimeFn = vi
      .fn()
      .mockResolvedValueOnce(firstRuntime)
      .mockResolvedValueOnce(secondRuntime);
    const controller = createMcporterController({} as never, {
      createRuntimeFn: createRuntimeFn as never,
      packageVersion: "1.0.0",
    });

    await controller.ensureRuntime("/repo-a");
    await controller.catalogStore.getBasicCatalog(firstRuntime);
    expect(controller.catalogStore.getCachedToolsForServer("alpha")).toEqual([
      expect.objectContaining({ selector: "alpha.repo_a_lookup" }),
    ]);

    await controller.ensureRuntime("/repo-b");
    expect(
      controller.catalogStore.getCachedToolsForServer("alpha"),
    ).toBeUndefined();
    await expect(
      controller.catalogStore.getBasicCatalog(secondRuntime),
    ).resolves.toMatchObject({
      tools: [expect.objectContaining({ selector: "alpha.repo_b_lookup" })],
    });
  });

  it("serializes concurrent runtime changes for different roots", async () => {
    let finishClosingFirst: (() => void) | undefined;
    const firstRuntime = createRuntimeStub();
    firstRuntime.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishClosingFirst = resolve;
        }),
    );
    const secondRuntime = createRuntimeStub();
    const thirdRuntime = createRuntimeStub();
    const createRuntimeFn = vi
      .fn()
      .mockResolvedValueOnce(firstRuntime)
      .mockResolvedValueOnce(secondRuntime)
      .mockResolvedValueOnce(thirdRuntime);
    const controller = createMcporterController({} as never, {
      createRuntimeFn: createRuntimeFn as never,
      packageVersion: "1.0.0",
    });

    await controller.ensureRuntime("/repo-a");
    const secondRequest = controller.ensureRuntime("/repo-b");
    await vi.waitFor(() => {
      expect(firstRuntime.close).toHaveBeenCalledTimes(1);
    });
    const thirdRequest = controller.ensureRuntime("/repo-c");

    expect(createRuntimeFn).toHaveBeenCalledTimes(1);
    finishClosingFirst?.();
    await expect(secondRequest).resolves.toBe(secondRuntime);
    await expect(thirdRequest).resolves.toBe(thirdRuntime);
    expect(createRuntimeFn).toHaveBeenNthCalledWith(2, {
      rootDir: "/repo-b",
      clientInfo: { name: "pi-mcporter", version: "1.0.0" },
    });
    expect(createRuntimeFn).toHaveBeenNthCalledWith(3, {
      rootDir: "/repo-c",
      clientInfo: { name: "pi-mcporter", version: "1.0.0" },
    });
  });

  it("uses serverModes only for prompt orchestration", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const previousHome = process.env.HOME;
    const runtime = createRuntimeStub(
      async (server) => [demoTool(server, "lookup")],
      ["alpha", "beta"],
    );
    process.env.HOME = homeDirectory;
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      join(settingsDirectory, "mcporter.json"),
      JSON.stringify({
        mode: "index",
        serverModes: { alpha: "lazy", beta: "preload" },
      }),
      "utf8",
    );

    try {
      const controller = createMcporterController({} as never, {
        createRuntimeFn: vi.fn().mockResolvedValue(runtime) as never,
        packageVersion: "1.0.0",
      });

      const first = await controller.buildSystemPromptAppend("/repo");
      expect(first).toContain("beta");
      expect(first).not.toContain("alpha");
      await delay(0);
      const second = await controller.buildSystemPromptAppend("/repo");
      expect(second).toContain("beta.lookup");
      expect(second).not.toContain("alpha.lookup");
    } finally {
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
  const definitions = new Map(
    servers.map((name) => [
      name,
      {
        name,
        command: { kind: "http", url: new URL("https://example.com") },
      },
    ]),
  );

  return {
    listServers: () => [...definitions.keys()],
    listTools,
    getDefinitions: () => [...definitions.values()],
    getDefinition: (server: string) => {
      const definition = definitions.get(server);
      if (!definition) {
        throw new Error("not implemented");
      }
      return definition;
    },
    registerDefinition: (definition: { name: string }) => {
      definitions.set(definition.name, definition);
    },
    callTool: async () => ({}),
    listResources: async () => ({}),
    connect: async () => {
      throw new Error("not implemented");
    },
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Runtime & { close: ReturnType<typeof vi.fn> };
}
