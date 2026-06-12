import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
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

  it("attaches configured command-backed env only to the matching runtime definition", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;
    const previousToken = process.env.EXCALIDRAW_API_KEY;
    const runtime = createRuntimeStub(undefined, ["excalidraw", "unrelated"]);
    const createRuntimeFn = vi.fn().mockResolvedValue(runtime);
    process.env.HOME = homeDirectory;
    delete process.env.EXCALIDRAW_API_KEY;
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        mcpServers: {
          excalidraw: {
            env: {
              EXCALIDRAW_API_KEY:
                "!node -e \"process.stdout.write('command-token\\n')\"",
            },
          },
        },
      }),
      "utf8",
    );

    try {
      const controller = createMcporterController({} as never, {
        createRuntimeFn: createRuntimeFn as never,
        packageVersion: "1.0.0",
      });

      await expect(controller.ensureRuntime()).resolves.toBe(runtime);
      expect(createRuntimeFn).toHaveBeenCalledTimes(1);
      expect(process.env.EXCALIDRAW_API_KEY).toBeUndefined();
      expect(runtime.getDefinition("excalidraw").env).toEqual({
        EXCALIDRAW_API_KEY: "command-token",
      });
      expect(runtime.getDefinition("unrelated").env).toBeUndefined();
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousToken === undefined) {
        delete process.env.EXCALIDRAW_API_KEY;
      } else {
        process.env.EXCALIDRAW_API_KEY = previousToken;
      }

      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("keeps non-command env setting values literal even when process env has the same name", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;
    const previousLiteralSource = process.env.LITERAL_SOURCE;
    const runtime = createRuntimeStub(undefined, ["demo"]);
    process.env.HOME = homeDirectory;
    process.env.LITERAL_SOURCE = "ambient-value";
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        mcpServers: {
          demo: {
            env: {
              TOKEN: "LITERAL_SOURCE",
            },
          },
        },
      }),
      "utf8",
    );

    try {
      const controller = createMcporterController({} as never, {
        createRuntimeFn: vi.fn().mockResolvedValue(runtime) as never,
        packageVersion: "1.0.0",
      });

      await expect(controller.ensureRuntime()).resolves.toBe(runtime);
      expect(runtime.getDefinition("demo").env).toEqual({
        TOKEN: "LITERAL_SOURCE",
      });
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousLiteralSource === undefined) {
        delete process.env.LITERAL_SOURCE;
      } else {
        process.env.LITERAL_SOURCE = previousLiteralSource;
      }

      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("does not resolve command-backed env while lazy prompt preloading is disabled", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const markerPath = join(homeDirectory, "secret-command-ran");
    const previousHome = process.env.HOME;
    const createRuntimeFn = vi.fn();
    process.env.HOME = homeDirectory;
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        mode: "lazy",
        mcpServers: {
          excalidraw: {
            env: {
              EXCALIDRAW_API_KEY: `!node -e "require('node:fs').writeFileSync('${markerPath}', 'ran')"`,
            },
          },
        },
      }),
      "utf8",
    );

    try {
      const controller = createMcporterController({} as never, {
        createRuntimeFn: createRuntimeFn as never,
        packageVersion: "1.0.0",
      });

      await expect(
        controller.buildSystemPromptAppend(),
      ).resolves.toBeUndefined();
      expect(createRuntimeFn).not.toHaveBeenCalled();
      await expect(stat(markerPath)).rejects.toThrow();
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

      await expect(controller.buildSystemPromptAppend()).resolves.toContain(
        "MCP servers are reachable",
      );
      await vi.waitFor(async () => {
        await expect(controller.buildSystemPromptAppend()).resolves.toContain(
          "alpha.lookup",
        );
      });
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
        "MCP servers are reachable",
      );
      await vi.advanceTimersByTimeAsync(0);
      await expect(controller.buildSystemPromptAppend()).resolves.toContain(
        "alpha.legacy_lookup",
      );
      expect(attempts).toBe(1);

      vi.advanceTimersByTime(CATALOG_TTL_MS + 1);

      await expect(controller.buildSystemPromptAppend()).resolves.toContain(
        "MCP servers are reachable",
      );
      await vi.advanceTimersByTimeAsync(0);
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
