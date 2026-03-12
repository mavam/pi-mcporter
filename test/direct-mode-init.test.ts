import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Runtime, ServerToolInfo } from "mcporter";

describe("direct mode extension initialization", () => {
  it("defers direct-tool activation until the Pi registry becomes available", async () => {
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
    let runtimeBound = false;
    let beforeAgentStart: (() => Promise<void>) | undefined;
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
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          return registeredTools.map((name) => ({ name, description: name }));
        },
        getActiveTools() {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          return [...activeTools];
        },
        registerTool(definition: unknown) {
          upsertRegisteredTool(
            registeredTools,
            (definition as { name: string }).name,
          );
        },
        setActiveTools(toolNames: string[]) {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          activeTools = [...toolNames];
        },
      } as never);

      expect(beforeAgentStart).toBeTypeOf("function");
      await expect(beforeAgentStart?.()).resolves.toBeUndefined();
      expect(registeredTools).toEqual(["mcporter"]);
      expect(activeTools).not.toContain("mcp__alpha__list_items");

      runtimeBound = true;
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

  it("registers hoisted tools once the Pi tool registry becomes available", async () => {
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
    let runtimeBound = false;
    let sessionStart:
      | ((event: unknown, ctx: { hasUI: boolean }) => Promise<void>)
      | undefined;
    let activeTools = ["mcporter", "bash", "read", "edit"];

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");

      await mcporterExtension({
        on(event: string, handler: unknown) {
          if (event === "session_start") {
            sessionStart = handler as (
              event: unknown,
              ctx: { hasUI: boolean },
            ) => Promise<void>;
          }
        },
        registerCommand() {},
        getAllTools() {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          return registeredTools.map((name) => ({ name, description: name }));
        },
        getActiveTools() {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          return [...activeTools];
        },
        registerTool(definition: unknown) {
          upsertRegisteredTool(
            registeredTools,
            (definition as { name: string }).name,
          );
        },
        setActiveTools(toolNames: string[]) {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          activeTools = [...toolNames];
        },
      } as never);

      expect(registeredTools).toEqual(["mcporter"]);
      expect(activeTools).not.toContain("mcp__alpha__list_items");

      runtimeBound = true;
      await sessionStart?.({}, { hasUI: false });

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

  it("suffixes direct-mode hoisted tools when Pi already exposes the generated name", async () => {
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
    const registeredTools = ["mcp__alpha__list_items"];
    let beforeAgentStart: (() => Promise<void>) | undefined;

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
          return ["mcporter", ...registeredTools];
        },
        registerTool(definition: unknown) {
          upsertRegisteredTool(
            registeredTools,
            (definition as { name: string }).name,
          );
        },
        setActiveTools() {},
      } as never);

      await beforeAgentStart?.();

      expect(registeredTools).toEqual([
        "mcp__alpha__list_items",
        "mcporter",
        "mcp__alpha__list_items__2",
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

  it("waits for the Pi tool registry before assigning colliding hoisted names", async () => {
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
    const registeredTools = ["mcp__alpha__list_items"];
    let runtimeBound = false;
    let sessionStart:
      | ((event: unknown, ctx: { hasUI: boolean }) => Promise<void>)
      | undefined;
    let activeTools = ["mcporter", "bash", "read", "edit"];

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");

      await mcporterExtension({
        on(event: string, handler: unknown) {
          if (event === "session_start") {
            sessionStart = handler as (
              event: unknown,
              ctx: { hasUI: boolean },
            ) => Promise<void>;
          }
        },
        registerCommand() {},
        getAllTools() {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          return registeredTools.map((name) => ({ name, description: name }));
        },
        getActiveTools() {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          return [...activeTools];
        },
        registerTool(definition: unknown) {
          upsertRegisteredTool(
            registeredTools,
            (definition as { name: string }).name,
          );
        },
        setActiveTools(toolNames: string[]) {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          activeTools = [...toolNames];
        },
      } as never);

      expect(registeredTools).toEqual(["mcp__alpha__list_items", "mcporter"]);
      expect(activeTools).not.toContain("mcp__alpha__list_items__2");

      runtimeBound = true;
      await sessionStart?.({}, { hasUI: false });

      expect(registeredTools).toEqual([
        "mcp__alpha__list_items",
        "mcporter",
        "mcp__alpha__list_items__2",
      ]);
      expect(activeTools).toContain("mcp__alpha__list_items__2");
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
    let runtimeBound = false;
    let sessionStart:
      | ((event: unknown, ctx: { hasUI: boolean }) => Promise<void>)
      | undefined;
    let sessionShutdown: (() => Promise<void>) | undefined;
    let activeTools = ["mcporter", "bash", "read", "edit"];

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");

      await mcporterExtension({
        on(event: string, handler: unknown) {
          if (event === "session_start") {
            sessionStart = handler as (
              event: unknown,
              ctx: { hasUI: boolean },
            ) => Promise<void>;
          }
          if (event === "session_shutdown") {
            sessionShutdown = handler as () => Promise<void>;
          }
        },
        registerCommand() {},
        getAllTools() {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          return activeTools.map((name) => ({ name, description: name }));
        },
        getActiveTools() {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          return [...activeTools];
        },
        registerTool() {},
        setActiveTools(toolNames: string[]) {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          activeTools = [...toolNames];
        },
      } as never);

      runtimeBound = true;
      await sessionStart?.({}, { hasUI: false });

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

  it("reactivates the original hoisted names after a session restart", async () => {
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
    let runtimeBound = false;
    let sessionStart:
      | ((event: unknown, ctx: { hasUI: boolean }) => Promise<void>)
      | undefined;
    let beforeAgentStart: (() => Promise<void>) | undefined;
    let sessionShutdown: (() => Promise<void>) | undefined;
    let activeTools = ["mcporter", "bash", "read", "edit"];

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");

      await mcporterExtension({
        on(event: string, handler: unknown) {
          if (event === "session_start") {
            sessionStart = handler as (
              event: unknown,
              ctx: { hasUI: boolean },
            ) => Promise<void>;
          }
          if (event === "before_agent_start") {
            beforeAgentStart = handler as () => Promise<void>;
          }
          if (event === "session_shutdown") {
            sessionShutdown = handler as () => Promise<void>;
          }
        },
        registerCommand() {},
        getAllTools() {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          return registeredTools.map((name) => ({ name, description: name }));
        },
        getActiveTools() {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          return [...activeTools];
        },
        registerTool(definition: unknown) {
          upsertRegisteredTool(
            registeredTools,
            (definition as { name: string }).name,
          );
        },
        setActiveTools(toolNames: string[]) {
          if (!runtimeBound) {
            throw new Error("Extension runtime not initialized");
          }
          activeTools = [...toolNames];
        },
      } as never);

      expect(registeredTools).toEqual(["mcporter"]);

      runtimeBound = true;
      await sessionStart?.({}, { hasUI: false });

      await sessionShutdown?.();

      expect(activeTools).not.toContain("mcp__alpha__list_items");

      await beforeAgentStart?.();

      expect(registeredTools).not.toContain("mcp__alpha__list_items__2");
      expect(
        registeredTools.filter((name) => name === "mcp__alpha__list_items"),
      ).toHaveLength(1);
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

  it("does not retry direct preload after a startup timeout", async () => {
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
          upsertRegisteredTool(
            registeredTools,
            (definition as { name: string }).name,
          );
        },
        setActiveTools(toolNames: string[]) {
          activeTools = [...toolNames];
        },
      } as never);

      expect(registeredTools).toEqual(["mcporter"]);
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
      expect(registeredTools).toEqual(["mcporter"]);
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
    const registeredTools: string[] = [];
    let activeTools = ["mcporter", "bash", "read", "edit"];

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ mode: "direct" }), "utf8");
    process.env.HOME = homeDirectory;

    try {
      const { default: mcporterExtension } = await import("../src/index.ts");

      const outcome = await Promise.race([
        Promise.resolve(
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
              upsertRegisteredTool(
                registeredTools,
                (definition as { name: string }).name,
              );
            },
            setActiveTools(toolNames: string[]) {
              activeTools = [...toolNames];
            },
          } as never),
        ).then(() => "resolved"),
        new Promise<"timed_out">((resolve) => {
          setTimeout(() => resolve("timed_out"), 250);
        }),
      ]);

      expect(outcome).toBe("resolved");
      expect(createRuntime).not.toHaveBeenCalled();
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

      await mcporterExtension({
        on(event: string, handler: unknown) {
          if (event === "before_agent_start") {
            beforeAgentStart = handler as () => Promise<void>;
          }
        },
        registerCommand() {},
        getAllTools() {
          return [{ name: "mcporter", description: "mcporter" }];
        },
        getActiveTools() {
          return ["mcporter", "bash", "read", "edit"];
        },
        registerTool() {},
        setActiveTools() {},
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

  it("resolves before_agent_start when settings are malformed and fails on tool use", async () => {
    vi.resetModules();

    let beforeAgentStart: (() => Promise<void>) | undefined;
    let mcporterTool:
      | {
          execute: (
            toolCallId: string,
            rawParams: unknown,
            signal?: AbortSignal,
          ) => Promise<unknown>;
        }
      | undefined;

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;
    let activeTools = ["mcporter", "bash", "read", "edit"];

    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsPath, '{"mode":"direct"', "utf8");
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
          return activeTools.map((name) => ({ name, description: name }));
        },
        getActiveTools() {
          return [...activeTools];
        },
        registerTool(definition: unknown) {
          if ((definition as { name: string }).name === "mcporter") {
            mcporterTool = definition as typeof mcporterTool;
          }
        },
        setActiveTools(toolNames: string[]) {
          activeTools = [...toolNames];
        },
      } as never);

      expect(beforeAgentStart).toBeTypeOf("function");
      expect(mcporterTool).toBeDefined();
      await expect(beforeAgentStart?.()).resolves.toBeUndefined();
      await expect(
        mcporterTool!.execute("call-1", {
          action: "search",
          query: "linear issues",
        }),
      ).rejects.toThrow(`Failed to load ${settingsPath}:`);
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

      vi.resetModules();
      await rm(homeDirectory, { recursive: true, force: true });
    }
  });

  it("resolves before_agent_start when runtime creation fails and fails on tool use", async () => {
    vi.resetModules();

    let beforeAgentStart: (() => Promise<void>) | undefined;
    let mcporterTool:
      | {
          execute: (
            toolCallId: string,
            rawParams: unknown,
            signal?: AbortSignal,
          ) => Promise<unknown>;
        }
      | undefined;
    const createRuntime = vi
      .fn()
      .mockRejectedValue(new Error("missing mcporter config"));
    vi.doMock("mcporter", () => ({ createRuntime }));

    const homeDirectory = await mkdtemp(join(tmpdir(), "pi-mcporter-home-"));
    const settingsDirectory = join(homeDirectory, ".pi", "agent");
    const settingsPath = join(settingsDirectory, "mcporter.json");
    const previousHome = process.env.HOME;
    let activeTools = ["mcporter", "bash", "read", "edit"];

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

      await mcporterExtension({
        on(event: string, handler: unknown) {
          if (event === "before_agent_start") {
            beforeAgentStart = handler as () => Promise<void>;
          }
        },
        registerCommand() {},
        getAllTools() {
          return activeTools.map((name) => ({ name, description: name }));
        },
        getActiveTools() {
          return [...activeTools];
        },
        registerTool(definition: unknown) {
          if ((definition as { name: string }).name === "mcporter") {
            mcporterTool = definition as typeof mcporterTool;
          }
        },
        setActiveTools(toolNames: string[]) {
          activeTools = [...toolNames];
        },
      } as never);

      expect(beforeAgentStart).toBeTypeOf("function");
      expect(mcporterTool).toBeDefined();
      await expect(beforeAgentStart?.()).resolves.toBeUndefined();
      expect(createRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: "/missing/mcporter.json",
        }),
      );
      await expect(
        mcporterTool!.execute("call-2", {
          action: "search",
          query: "linear issues",
        }),
      ).rejects.toThrow("missing mcporter config");
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

      await mcporterExtension({
        on(event: string, handler: unknown) {
          if (event === "before_agent_start") {
            beforeAgentStart = handler as () => Promise<void>;
          }
        },
        registerCommand() {},
        getAllTools() {
          return [];
        },
        getActiveTools() {
          return ["mcporter"];
        },
        registerTool() {},
        setActiveTools() {},
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

function upsertRegisteredTool(registeredTools: string[], name: string): void {
  const existingIndex = registeredTools.indexOf(name);
  if (existingIndex >= 0) {
    registeredTools[existingIndex] = name;
    return;
  }
  registeredTools.push(name);
}
