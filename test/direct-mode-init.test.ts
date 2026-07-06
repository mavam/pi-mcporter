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
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const previousHome = process.env.HOME;
    process.env.HOME = homeDirectory;
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      join(settingsDirectory, "mcporter.json"),
      JSON.stringify({ mode: "lazy" }),
      "utf8",
    );

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension(pi.api);

      await expect(pi.beforeAgentStart()).resolves.toBeUndefined();
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

  it("appends a server index by default without fetching tool catalogs", async () => {
    vi.resetModules();

    const listTools = vi.fn<Runtime["listTools"]>();
    const runtime = createRuntimeStub(listTools, ["alpha", "beta"]);
    const createRuntime = vi.fn().mockResolvedValue(runtime);
    vi.doMock("mcporter", () => ({ createRuntime }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension(pi.api);

      const result = await pi.beforeAgentStart();

      expect(listTools).not.toHaveBeenCalled();
      expect(createRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ rootDir: "/repo" }),
      );
      const systemPrompt = (result as { systemPrompt: string }).systemPrompt;
      expect(systemPrompt).toContain(
        "MCP servers are reachable through the `mcporter` tool: alpha, beta.",
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

  it("injects nothing when the runtime has no servers", async () => {
    vi.resetModules();

    const listTools = vi.fn<Runtime["listTools"]>();
    const runtime = createRuntimeStub(listTools, []);
    vi.doMock("mcporter", () => ({
      createRuntime: vi.fn().mockResolvedValue(runtime),
    }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension(pi.api);

      await expect(pi.beforeAgentStart()).resolves.toBeUndefined();
      expect(listTools).not.toHaveBeenCalled();
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

  it("injects nothing when every server resolves to lazy mode", async () => {
    vi.resetModules();

    const listTools = vi.fn<Runtime["listTools"]>();
    const runtime = createRuntimeStub(listTools, ["alpha"]);
    vi.doMock("mcporter", () => ({
      createRuntime: vi.fn().mockResolvedValue(runtime),
    }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const previousHome = process.env.HOME;

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      join(settingsDirectory, "mcporter.json"),
      JSON.stringify({
        mode: "index",
        serverModes: { alpha: "lazy" },
      }),
      "utf8",
    );
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension(pi.api);

      await expect(pi.beforeAgentStart()).resolves.toBeUndefined();
      expect(listTools).not.toHaveBeenCalled();
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

  it("still accepts legacy mcpServers.<name>.mode for migration", async () => {
    vi.resetModules();

    const listTools = vi.fn<Runtime["listTools"]>();
    const runtime = createRuntimeStub(listTools, ["alpha"]);
    vi.doMock("mcporter", () => ({
      createRuntime: vi.fn().mockResolvedValue(runtime),
    }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const previousHome = process.env.HOME;

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      join(settingsDirectory, "mcporter.json"),
      JSON.stringify({
        mode: "index",
        mcpServers: { alpha: { mode: "lazy" } },
      }),
      "utf8",
    );
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension(pi.api);

      await expect(pi.beforeAgentStart()).resolves.toBeUndefined();
      expect(listTools).not.toHaveBeenCalled();
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

      const firstTurn = await pi.beforeAgentStart();

      expect((firstTurn as { systemPrompt: string }).systemPrompt).toContain(
        "MCP servers are reachable through the `mcporter` tool: alpha.",
      );

      await vi.waitFor(() => {
        expect(listTools).toHaveBeenCalledTimes(1);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = await pi.beforeAgentStart();

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

  it("preloads only servers with a per-server preload mode in global lazy mode", async () => {
    vi.resetModules();

    const listTools = vi
      .fn<Runtime["listTools"]>()
      .mockImplementation(async (server) => [demoTool(server, "list_items")]);
    const runtime = createRuntimeStub(listTools, ["alpha", "beta"]);
    vi.doMock("mcporter", () => ({
      createRuntime: vi.fn().mockResolvedValue(runtime),
    }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        mode: "lazy",
        serverModes: { beta: "preload" },
      }),
      "utf8",
    );
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension(pi.api);

      const firstTurn = await pi.beforeAgentStart();
      const firstPrompt = (firstTurn as { systemPrompt: string }).systemPrompt;
      expect(firstPrompt).toContain(
        "MCP servers are reachable through the `mcporter` tool: beta.",
      );
      expect(firstPrompt).not.toContain("alpha");

      await vi.waitFor(() => {
        expect(listTools).toHaveBeenCalledTimes(1);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = await pi.beforeAgentStart();

      expect(listTools).toHaveBeenCalledTimes(1);
      expect(listTools).toHaveBeenCalledWith("beta", expect.anything());
      const systemPrompt = (result as { systemPrompt: string }).systemPrompt;
      expect(systemPrompt).toContain("beta.list_items");
      expect(systemPrompt).not.toContain("alpha.list_items");
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

  it("excludes servers with a per-server lazy mode in global preload mode", async () => {
    vi.resetModules();

    const listTools = vi
      .fn<Runtime["listTools"]>()
      .mockImplementation(async (server) => [demoTool(server, "list_items")]);
    const runtime = createRuntimeStub(listTools, ["alpha", "beta"]);
    vi.doMock("mcporter", () => ({
      createRuntime: vi.fn().mockResolvedValue(runtime),
    }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        mode: "preload",
        serverModes: { beta: "lazy" },
      }),
      "utf8",
    );
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension(pi.api);

      const firstTurn = await pi.beforeAgentStart();
      const firstPrompt = (firstTurn as { systemPrompt: string }).systemPrompt;
      expect(firstPrompt).toContain(
        "MCP servers are reachable through the `mcporter` tool: alpha.",
      );
      expect(firstPrompt).not.toContain("beta");

      await vi.waitFor(() => {
        expect(listTools).toHaveBeenCalledTimes(1);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = await pi.beforeAgentStart();

      expect(listTools).toHaveBeenCalledTimes(1);
      expect(listTools).toHaveBeenCalledWith("alpha", expect.anything());
      const systemPrompt = (result as { systemPrompt: string }).systemPrompt;
      expect(systemPrompt).toContain("alpha.list_items");
      expect(systemPrompt).not.toContain("beta.list_items");
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

  it("skips prompt preloading when mcporter is inactive", async () => {
    vi.resetModules();

    const createRuntime = vi.fn();
    vi.doMock("mcporter", () => ({ createRuntime }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "preload" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub(["bash", "read", "edit"]);

      await mcporterExtension(pi.api);

      await expect(pi.beforeAgentStart()).resolves.toBeUndefined();
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

  it("keeps MCPorter calls working when pi-mcporter settings are malformed", async () => {
    vi.resetModules();

    const runtime = createRuntimeStub(
      async () => [demoTool("alpha", "lookup")],
      ["alpha"],
    );
    const createRuntime = vi.fn().mockResolvedValue(runtime);
    vi.doMock("mcporter", () => ({ createRuntime }));

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

      await mcporterExtension(pi.api);

      await expect(pi.beforeAgentStart()).resolves.toBeUndefined();
      await expect(
        pi.executeMcporter({ action: "search", query: "lookup" }),
      ).resolves.toMatchObject({
        details: {
          action: "search",
          resultCount: 1,
        },
      });
      expect(createRuntime).toHaveBeenCalledWith(
        expect.not.objectContaining({ configPath: expect.any(String) }),
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

  it("delegates MCPORTER_CONFIG handling to mcporter", async () => {
    vi.resetModules();

    const runtime = createRuntimeStub(async () => [], []);
    const createRuntime = vi.fn().mockResolvedValue(runtime);
    vi.doMock("mcporter", () => ({ createRuntime }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const previousHome = process.env.HOME;
    const previousConfig = process.env.MCPORTER_CONFIG;
    process.env.HOME = homeDirectory;
    process.env.MCPORTER_CONFIG = " /env/mcporter.json ";

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");
      const pi = createExtensionPiStub();

      await mcporterExtension(pi.api);
      await pi.beforeAgentStart();

      expect(createRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ rootDir: "/repo" }),
      );
      expect(createRuntime.mock.calls[0]?.[0]).not.toHaveProperty("configPath");
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

  it("resolves before_agent_start when runtime creation fails and fails on tool use", async () => {
    vi.resetModules();

    const createRuntime = vi
      .fn()
      .mockRejectedValue(new Error("missing mcporter config"));
    vi.doMock("mcporter", () => ({ createRuntime }));

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

      await expect(pi.beforeAgentStart()).resolves.toBeUndefined();
      expect(createRuntime).toHaveBeenCalledWith(
        expect.not.objectContaining({ configPath: expect.any(String) }),
      );
      await expect(
        pi.executeMcporter({ action: "search", query: "linear issues" }),
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
        execute: (...args: unknown[]) => Promise<unknown>;
      }
    | undefined;
  const ctx = { cwd: "/repo" };

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
    async beforeAgentStart(
      event: unknown = {
        prompt: "show me my items",
        images: [],
        systemPrompt: "Base system prompt",
      },
    ) {
      return await handlers.get("before_agent_start")?.(event, ctx);
    },
    async executeMcporter(params: unknown) {
      if (!mcporterTool) {
        throw new Error("mcporter tool was not registered");
      }
      return await mcporterTool.execute(
        "call-1",
        params,
        undefined,
        undefined,
        ctx,
      );
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
