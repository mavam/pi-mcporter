import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Runtime, ServerToolInfo } from "mcporter";

describe("direct mode extension initialization", () => {
  it("falls back to preload and warns instead of registering direct tools", async () => {
    vi.resetModules();

    const listTools = vi
      .fn<Runtime["listTools"]>()
      .mockImplementation(async (server) => [demoTool(server, "list_items")]);
    const runtime = createRuntimeStub(listTools, ["alpha"]);
    vi.doMock("mcporter", () => ({
      createRuntime: vi.fn().mockResolvedValue(runtime),
    }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension(pi.api);

      expect(pi.registeredTools).toEqual(["mcporter"]);
      expect(pi.activeTools).toEqual(
        expect.arrayContaining(["mcporter", "bash", "read", "edit"]),
      );

      await pi.sessionStart({ hasUI: true });

      expect(listTools).toHaveBeenCalledTimes(1);
      expect(pi.registeredTools).toEqual(["mcporter"]);
      expect(pi.activeTools).toEqual(
        expect.arrayContaining(["mcporter", "bash", "read", "edit"]),
      );
      expect(pi.activeTools).not.toContain("mcp__alpha__list_items");
      expect(pi.notifications).toEqual([
        {
          level: "warning",
          message:
            "mcporter extension: direct MCP tool exposure requires session-scoped tool registration; using preload mode instead.",
        },
      ]);
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

  it("keeps the registry clean across a later lazy session in the same process", async () => {
    vi.resetModules();

    const listTools = vi
      .fn<Runtime["listTools"]>()
      .mockImplementation(async (server) => [demoTool(server, "list_items")]);
    const runtime = createRuntimeStub(listTools, ["alpha"]);
    vi.doMock("mcporter", () => ({
      createRuntime: vi.fn().mockResolvedValue(runtime),
    }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension(pi.api);
      await pi.sessionStart({ hasUI: true });
      await pi.sessionShutdown();

      await writeFile(settingsPath, JSON.stringify({ mode: "lazy" }), "utf8");
      pi.notifications.splice(0, pi.notifications.length);
      await pi.sessionStart({ hasUI: true });

      expect(listTools).toHaveBeenCalledTimes(1);
      expect(pi.registeredTools).toEqual(["mcporter"]);
      expect(pi.activeTools).toEqual(
        expect.arrayContaining(["mcporter", "bash", "read", "edit"]),
      );
      expect(pi.activeTools).not.toContain("mcp__alpha__list_items");
      expect(pi.notifications).toEqual([]);
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

  it("does not retry fallback preload after a startup timeout", async () => {
    vi.resetModules();

    let beforeAgentStart: (() => Promise<void>) | undefined;
    let attempts = 0;
    const runtime = createRuntimeStub(async () => {
      attempts += 1;
      return await new Promise<ServerToolInfo[]>(() => {});
    }, ["alpha"]);
    vi.doMock("mcporter", () => ({
      createRuntime: vi.fn().mockResolvedValue(runtime),
    }));
    vi.doMock("../src/constants.ts", async () => {
      const actual = await vi.importActual<
        typeof import("../src/constants.ts")
      >("../src/constants.ts");
      return {
        ...actual,
        DEFAULT_CATALOG_LIST_TIMEOUT_MS: 25,
      };
    });

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
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

      expect(pi.registeredTools).toEqual(["mcporter"]);
      expect(attempts).toBe(0);
      expect(beforeAgentStart).toBeTypeOf("function");

      const outcome = await Promise.race([
        beforeAgentStart!().then(() => "resolved"),
        new Promise<"timed_out">((resolve) => {
          setTimeout(() => resolve("timed_out"), 250);
        }),
      ]);

      expect(outcome).toBe("resolved");
      expect(attempts).toBe(1);
      await beforeAgentStart?.();
      expect(attempts).toBe(1);
      expect(pi.registeredTools).toEqual(["mcporter"]);
      expect(pi.activeTools).not.toContain("mcp__alpha__list_items");
      expect(pi.activeTools).toEqual(
        expect.arrayContaining(["mcporter", "bash", "read", "edit"]),
      );
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      vi.doUnmock("../src/constants.ts");
      vi.doUnmock("mcporter");
      vi.resetModules();
      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("does not start runtime or preload during extension load", async () => {
    vi.resetModules();

    const createRuntime = vi.fn();
    vi.doMock("mcporter", () => ({ createRuntime }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      const outcome = await Promise.race([
        Promise.resolve(mcporterExtension(pi.api)).then(() => "resolved"),
        new Promise<"timed_out">((resolve) => {
          setTimeout(() => resolve("timed_out"), 250);
        }),
      ]);

      expect(outcome).toBe("resolved");
      expect(createRuntime).not.toHaveBeenCalled();
      expect(pi.registeredTools).toEqual(["mcporter"]);
      expect(pi.activeTools).toEqual(
        expect.arrayContaining(["mcporter", "bash", "read", "edit"]),
      );
      expect(pi.activeTools).not.toContain("mcp__alpha__list_items");
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

  it("skips before_agent_start warmup in lazy mode", async () => {
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

      expect(beforeAgentStart).toBeTypeOf("function");
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
    await writeFile(settingsPath, '{"mode":"direct"', "utf8");
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

      expect(beforeAgentStart).toBeTypeOf("function");
      expect(pi.mcporterTool).toBeDefined();
      await expect(beforeAgentStart?.()).resolves.toBeUndefined();
      await expect(
        pi.mcporterTool!.execute("call-1", {
          action: "search",
          query: "linear issues",
        }),
      ).rejects.toThrow(`Failed to load ${settingsPath}:`);
      expect(pi.activeTools).toEqual(
        expect.arrayContaining(["mcporter", "bash", "read", "edit"]),
      );
      expect(pi.activeTools).not.toContain("mcp__alpha__list_items");
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
        mode: "direct",
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

      expect(beforeAgentStart).toBeTypeOf("function");
      expect(pi.mcporterTool).toBeDefined();
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
      expect(pi.activeTools).toEqual(
        expect.arrayContaining(["mcporter", "bash", "read", "edit"]),
      );
      expect(pi.activeTools).not.toContain("mcp__alpha__list_items");
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

  it("falls back to MCPORTER_CONFIG before settings configPath", async () => {
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
  const notifications: Array<{ level: string; message: string }> = [];
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
    get activeTools() {
      return [...activeTools];
    },
    handlers,
    get mcporterTool() {
      return mcporterTool;
    },
    notifications,
    registeredTools,
    async beforeAgentStart(event: unknown = {}) {
      return await handlers.get("before_agent_start")?.(event);
    },
    async sessionShutdown() {
      await handlers.get("session_shutdown")?.();
    },
    async sessionStart(options: { hasUI: boolean }) {
      await handlers.get("session_start")?.(
        {},
        {
          hasUI: options.hasUI,
          ui: {
            notify(message: string, level: string) {
              notifications.push({ level, message });
            },
          },
        },
      );
    },
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
