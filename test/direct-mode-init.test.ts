import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Runtime, ServerToolInfo } from "mcporter";

describe("extension startup modes", () => {
  it("does not start the runtime during extension load", async () => {
    vi.resetModules();

    const createRuntime = vi.fn();
    vi.doMock("mcporter", () => ({ createRuntime }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      mcporterExtension(pi.api);
      expect(createRuntime).not.toHaveBeenCalled();
      expect(pi.registeredTools).toEqual(["mcporter"]);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      vi.doUnmock("mcporter");
      vi.resetModules();
      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("skips prompt preloading in lazy mode", async () => {
    vi.resetModules();

    const createRuntime = vi.fn();
    vi.doMock("mcporter", () => ({ createRuntime }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const previousHome = process.env.HOME;
    let beforeAgentStart: (() => Promise<void>) | undefined;
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension({
        ...pi.api,
        on(event: string, handler: unknown) {
          if (event === "before_agent_start") {
            beforeAgentStart = handler as () => Promise<void>;
          }
          pi.api.on(event, handler);
        },
      } as never);

      await expect(beforeAgentStart?.()).resolves.toBeUndefined();
      expect(createRuntime).not.toHaveBeenCalled();
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      vi.doUnmock("mcporter");
      vi.resetModules();
      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("injects warmed preload catalog metadata into the system prompt", async () => {
    vi.resetModules();

    const listTools = vi
      .fn<Runtime["listTools"]>()
      .mockImplementation(async (server) => [
        demoTool(server, "list_items"),
        demoTool(server, "create_item"),
      ]);
    const runtime = createRuntimeStub(listTools, ["alpha"]);
    vi.doMock("mcporter", () => ({
      createRuntime: vi.fn().mockResolvedValue(runtime),
    }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "preload" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension(pi.api);

      const result = await pi.beforeAgentStart({
        prompt: "show me my items",
        images: [],
        systemPrompt: "Base system prompt",
      });

      expect(listTools).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        systemPrompt: expect.stringContaining(
          "MCPorter preloaded MCP catalog metadata for this turn.",
        ),
      });
      expect((result as { systemPrompt: string }).systemPrompt).toContain(
        "alpha.create_item",
      );
      expect((result as { systemPrompt: string }).systemPrompt).toContain(
        "alpha.list_items",
      );
      expect((result as { systemPrompt: string }).systemPrompt).toContain(
        "action='call' directly",
      );
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      vi.doUnmock("mcporter");
      vi.resetModules();
      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("resolves before_agent_start when settings are malformed and fails on tool use", async () => {
    vi.resetModules();

    let beforeAgentStart: (() => Promise<void>) | undefined;
    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, '{"mode":"preload"', "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension({
        ...pi.api,
        on(event: string, handler: unknown) {
          if (event === "before_agent_start") {
            beforeAgentStart = handler as () => Promise<void>;
          }
          pi.api.on(event, handler);
        },
      } as never);

      await expect(beforeAgentStart?.()).resolves.toBeUndefined();
      await expect(
        pi.mcporterTool!.execute("call-1", {
          action: "search",
          query: "linear issues",
        }),
      ).rejects.toThrow(`Failed to load ${settingsPath}:`);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      vi.resetModules();
      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("resolves before_agent_start when runtime creation fails and fails on tool use", async () => {
    vi.resetModules();

    let beforeAgentStart: (() => Promise<void>) | undefined;
    const createRuntime = vi
      .fn()
      .mockRejectedValue(new Error("missing mcporter config"));
    vi.doMock("mcporter", () => ({ createRuntime }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        mode: "preload",
        configPath: "/missing/mcporter.json",
      }),
      "utf8",
    );
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension({
        ...pi.api,
        on(event: string, handler: unknown) {
          if (event === "before_agent_start") {
            beforeAgentStart = handler as () => Promise<void>;
          }
          pi.api.on(event, handler);
        },
      } as never);

      await expect(beforeAgentStart?.()).resolves.toBeUndefined();
      expect(createRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: "/missing/mcporter.json",
        }),
      );
      await expect(
        pi.mcporterTool!.execute("call-2", {
          action: "search",
          query: "linear issues",
        }),
      ).rejects.toThrow("missing mcporter config");
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      vi.doUnmock("mcporter");
      vi.resetModules();
      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("prefers MCPORTER_CONFIG over the settings configPath", async () => {
    vi.resetModules();

    const runtime = createRuntimeStub(async () => [], []);
    const createRuntime = vi.fn().mockResolvedValue(runtime);
    let beforeAgentStart: (() => Promise<void>) | undefined;
    vi.doMock("mcporter", () => ({ createRuntime }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;
    const previousConfig = process.env.MCPORTER_CONFIG;

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        mode: "preload",
        configPath: "/settings/mcporter.json",
      }),
      "utf8",
    );
    process.env.HOME = homeDirectory;
    process.env.MCPORTER_CONFIG = " /env/mcporter.json ";

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub(["mcporter"]);

      await mcporterExtension({
        ...pi.api,
        on(event: string, handler: unknown) {
          if (event === "before_agent_start") {
            beforeAgentStart = handler as () => Promise<void>;
          }
          pi.api.on(event, handler);
        },
      } as never);

      await beforeAgentStart?.();

      expect(createRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: "/env/mcporter.json",
        }),
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

      vi.doUnmock("mcporter");
      vi.resetModules();
      await rm(homeDirectory, { recursive: true, force: true });
    }
  });
});

function demoTool(
  server: string,
  name: string,
  inputSchema?: unknown,
): ServerToolInfo {
  return {
    name,
    description: `${server}.${name}`,
    inputSchema,
  };
}

function createRuntimeStub(
  listTools: Runtime["listTools"],
  servers: string[],
): Runtime {
  return {
    listServers: () => [...servers],
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

function createExtensionPiStub(
  initialActiveTools: string[] = ["mcporter", "bash", "read", "edit"],
) {
  const registeredTools: string[] = [];
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  let activeTools = [...initialActiveTools];
  let mcporterTool:
    | {
        execute: (
          toolCallId: string,
          rawParams: unknown,
          signal?: AbortSignal,
        ) => Promise<unknown>;
      }
    | undefined;

  const api = {
    on(event: string, handler: unknown) {
      handlers.set(event, handler as (...args: unknown[]) => Promise<void>);
    },
    registerCommand() {},
    getAllTools() {
      return [...new Set([...registeredTools, ...activeTools])].map((name) => ({
        name,
        description: name,
      }));
    },
    getActiveTools() {
      return [...activeTools];
    },
    registerTool(definition: unknown) {
      const name = (definition as { name: string }).name;
      upsertRegisteredTool(registeredTools, name);
      if (name === "mcporter") {
        mcporterTool = definition as typeof mcporterTool;
      }
    },
    setActiveTools(toolNames: string[]) {
      activeTools = [...toolNames];
    },
  };

  return {
    api: api as never,
    async beforeAgentStart(event: unknown = {}) {
      return await handlers.get("before_agent_start")?.(event);
    },
    get mcporterTool() {
      return mcporterTool;
    },
    registeredTools,
  };
}

function upsertRegisteredTool(registeredTools: string[], name: string): void {
  const existingIndex = registeredTools.indexOf(name);
  if (existingIndex >= 0) {
    registeredTools[existingIndex] = name;
    return;
  }
  registeredTools.push(name);
}
