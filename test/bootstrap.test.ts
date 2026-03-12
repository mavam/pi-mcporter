import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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
      const controller = createMcporterController(createPiStub(), {
        createRuntimeFn: createRuntimeFn as never,
        packageVersion: "1.0.0",
      });

      const warmupPromise = controller.warmup();
      await vi.waitFor(() => {
        expect(createRuntimeFn).toHaveBeenCalledTimes(1);
      });
      await controller.shutdown();

      resolveRuntime?.(runtime);
      await expect(warmupPromise).resolves.toEqual({ warnings: [] });
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

  it("does not reactivate hoisted tools when preload resolves after shutdown", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;
    let resolveListTools: ((tools: ServerToolInfo[]) => void) | undefined;
    const activeTools = ["mcporter", "bash"];
    const pi = createPiStub(activeTools);
    const runtime = createRuntimeStub(
      async () =>
        await new Promise<ServerToolInfo[]>((resolve) => {
          resolveListTools = resolve;
        }),
      ["alpha"],
    );
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const controller = createMcporterController(pi, {
        createRuntimeFn: vi.fn().mockResolvedValue(runtime) as never,
        packageVersion: "1.0.0",
      });
      const warmupPromise = controller.warmup();
      await vi.waitFor(() => {
        expect(resolveListTools).toBeTypeOf("function");
      });

      await controller.shutdown();
      resolveListTools?.([
        {
          name: "list_items",
          description: "alpha.list_items",
        },
      ]);

      await expect(warmupPromise).resolves.toEqual({ warnings: [] });
      expect(activeTools).toEqual(["mcporter", "bash"]);
      expect(pi.registeredToolNames).toEqual([]);
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

function createPiStub(activeTools: string[] = []) {
  const registeredToolNames: string[] = [];

  return {
    registeredToolNames,
    getAllTools() {
      return [...activeTools, ...registeredToolNames].map((name) => ({
        name,
        description: name,
      }));
    },
    getActiveTools() {
      return [...activeTools];
    },
    registerTool(definition: unknown) {
      registeredToolNames.push((definition as { name: string }).name);
    },
    setActiveTools(toolNames: string[]) {
      activeTools.splice(0, activeTools.length, ...toolNames);
    },
  } as ExtensionAPI & { registeredToolNames: string[] };
}
