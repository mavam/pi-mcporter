import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Runtime, ServerToolInfo } from "mcporter";

describe("direct mode extension initialization", () => {
  it("registers hoisted tools before the extension load completes", async () => {
    vi.resetModules();

    const runtime = createRuntimeStub(
      async (server) => [demoTool(server, "list_items")],
      ["alpha"],
    );
    vi.doMock("mcporter", () => ({
      createRuntime: vi.fn().mockResolvedValue(runtime),
    }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;
    const registeredTools: string[] = [];
    let activeTools = ["mcporter", "bash", "read", "edit"];

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");

      await mcporterExtension({
        on() {},
        registerCommand() {},
        getAllTools() {
          return registeredTools.map((name) => ({ name, description: name }));
        },
        getActiveTools() {
          return [...activeTools];
        },
        registerTool(definition: unknown) {
          registeredTools.push((definition as { name: string }).name);
        },
        setActiveTools(toolNames: string[]) {
          activeTools = [...toolNames];
        },
      } as never);

      expect(registeredTools).toContain("mcporter");
      expect(registeredTools).toContain("mcp__alpha__list_items");
      expect(activeTools).toContain("mcp__alpha__list_items");
      expect(activeTools).toEqual(
        expect.arrayContaining(["mcporter", "bash", "read", "edit"]),
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

  it("deactivates direct tools on session shutdown", async () => {
    vi.resetModules();

    const runtime = createRuntimeStub(
      async (server) => [demoTool(server, "list_items")],
      ["alpha"],
    );
    vi.doMock("mcporter", () => ({
      createRuntime: vi.fn().mockResolvedValue(runtime),
    }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;
    let sessionShutdown: (() => Promise<void>) | undefined;
    let activeTools = ["mcporter", "bash", "read", "edit"];

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");

      await mcporterExtension({
        on(event: string, handler: unknown) {
          if (event === "session_shutdown") {
            sessionShutdown = handler as () => Promise<void>;
          }
        },
        registerCommand() {},
        getAllTools() {
          return activeTools.map((name) => ({ name, description: name }));
        },
        getActiveTools() {
          return [...activeTools];
        },
        registerTool() {},
        setActiveTools(toolNames: string[]) {
          activeTools = [...toolNames];
        },
      } as never);

      expect(activeTools).toContain("mcp__alpha__list_items");
      expect(activeTools).toEqual(
        expect.arrayContaining(["mcporter", "bash", "read", "edit"]),
      );

      await sessionShutdown?.();

      expect(activeTools).not.toContain("mcp__alpha__list_items");
      expect(activeTools).toEqual(
        expect.arrayContaining(["mcporter", "bash", "read", "edit"]),
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

  it("retries direct tool registration after a startup warning", async () => {
    vi.resetModules();

    let attempts = 0;
    const runtime = createRuntimeStub(
      async (server) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("auth missing");
        }
        return [demoTool(server, "list_items")];
      },
      ["alpha"],
    );
    vi.doMock("mcporter", () => ({
      createRuntime: vi.fn().mockResolvedValue(runtime),
    }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;
    let beforeAgentStart: (() => Promise<void>) | undefined;
    const registeredTools: string[] = [];
    let activeTools = ["mcporter", "bash", "read", "edit"];

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");

      await mcporterExtension({
        on(event: string, handler: unknown) {
          if (event === "before_agent_start") {
            beforeAgentStart = handler as () => Promise<void>;
          }
        },
        registerCommand() {},
        getAllTools() {
          return registeredTools.map((name) => ({ name, description: name }));
        },
        getActiveTools() {
          return [...activeTools];
        },
        registerTool(definition: unknown) {
          registeredTools.push((definition as { name: string }).name);
        },
        setActiveTools(toolNames: string[]) {
          activeTools = [...toolNames];
        },
      } as never);

      expect(registeredTools).toEqual(["mcporter"]);

      await beforeAgentStart?.();

      expect(registeredTools).toContain("mcp__alpha__list_items");
      expect(activeTools).toContain("mcp__alpha__list_items");
      expect(activeTools).toEqual(
        expect.arrayContaining(["mcporter", "bash", "read", "edit"]),
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

  it("does not block extension load when direct preload times out", async () => {
    vi.resetModules();

    const runtime = createRuntimeStub(
      async () => await new Promise<ServerToolInfo[]>(() => {}),
      ["alpha"],
    );
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
    const registeredTools: string[] = [];
    let activeTools = ["mcporter", "bash", "read", "edit"];

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");

      const outcome = await Promise.race([
        mcporterExtension({
          on() {},
          registerCommand() {},
          getAllTools() {
            return registeredTools.map((name) => ({ name, description: name }));
          },
          getActiveTools() {
            return [...activeTools];
          },
          registerTool(definition: unknown) {
            registeredTools.push((definition as { name: string }).name);
          },
          setActiveTools(toolNames: string[]) {
            activeTools = [...toolNames];
          },
        } as never).then(() => "resolved"),
        new Promise<"timed_out">((resolve) => {
          setTimeout(() => resolve("timed_out"), 250);
        }),
      ]);

      expect(outcome).toBe("resolved");
      expect(registeredTools).toEqual(["mcporter"]);
      expect(activeTools).toEqual(
        expect.arrayContaining(["mcporter", "bash", "read", "edit"]),
      );
      expect(activeTools).not.toContain("mcp__alpha__list_items");
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
