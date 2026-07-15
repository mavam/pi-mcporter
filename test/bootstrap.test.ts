import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Runtime, ServerToolInfo } from "mcporter";
import { createMcporterController } from "../src/bootstrap.ts";

describe("createMcporterController", () => {
  it("closes runtimes that finish creating after shutdown", async () => {
    const runtime = createRuntimeStub();
    let resolveRuntime: ((runtime: Runtime) => void) | undefined;
    const createRuntimeFn = vi.fn().mockImplementation(
      () =>
        new Promise<Runtime>((resolve) => {
          resolveRuntime = resolve;
        }),
    );
    const controller = createController(createRuntimeFn);

    const runtimePromise = controller.ensureRuntime("/repo");
    await vi.waitFor(() => expect(createRuntimeFn).toHaveBeenCalledOnce());
    await controller.shutdown();
    resolveRuntime?.(runtime);

    await expect(runtimePromise).rejects.toThrow("Stale runtime session");
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("does not create a runtime for on-demand exposure", async () => {
    const fixture = await createSettingsFixture({
      version: 1,
      defaultExposure: "on-demand",
    });
    const createRuntimeFn = vi.fn();

    try {
      const controller = createController(createRuntimeFn, fixture.agentDir);
      const prepared = await controller.prepareTurn({
        prompt: "hello",
        proxyActive: true,
        rootDir: fixture.rootDir,
      });
      expect(prepared.nativeTools).toEqual([]);
      expect(prepared.systemPromptAppend).toBeUndefined();
      expect(createRuntimeFn).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it("appends the default server index without listing tools", async () => {
    const runtime = createRuntimeStub(undefined, ["alpha", "beta"]);
    const controller = createController(vi.fn().mockResolvedValue(runtime));

    const prepared = await controller.prepareTurn({
      prompt: "hello",
      proxyActive: true,
      rootDir: "/repo",
    });

    expect(prepared.systemPromptAppend).toContain("`alpha`, `beta`");
    expect(runtime.listTools).not.toHaveBeenCalled();
  });

  it("re-reads call timeout configuration on every use", async () => {
    const fixture = await createSettingsFixture({
      version: 1,
      callTimeoutMs: 45_000,
    });

    try {
      const controller = createController(
        vi.fn().mockResolvedValue(createRuntimeStub()),
        fixture.agentDir,
      );
      await expect(
        controller.resolveCallTimeout(undefined, fixture.rootDir),
      ).resolves.toBe(45_000);

      await fixture.writeGlobal({ version: 1, callTimeoutMs: 60_000 });
      await expect(
        controller.resolveCallTimeout(undefined, fixture.rootDir),
      ).resolves.toBe(60_000);
    } finally {
      await fixture.cleanup();
    }
  });

  it("disables enrichment for invalid config and deduplicates its warning", async () => {
    const fixture = await createSettingsFixtureRaw("{");
    const createRuntimeFn = vi.fn();

    try {
      const controller = createController(createRuntimeFn, fixture.agentDir);
      const first = await controller.prepareTurn({
        prompt: "hello",
        proxyActive: true,
        rootDir: fixture.rootDir,
      });
      const second = await controller.prepareTurn({
        prompt: "hello again",
        proxyActive: true,
        rootDir: fixture.rootDir,
      });

      expect(first.warnings).toEqual([
        expect.stringContaining("exposure enrichment is disabled"),
      ]);
      expect(second.warnings).toEqual([]);
      expect(first.nativeTools).toEqual([]);
      expect(first.systemPromptAppend).toBeUndefined();
      expect(createRuntimeFn).not.toHaveBeenCalled();
      await expect(
        controller.resolveCallTimeout(undefined, fixture.rootDir),
      ).resolves.toBe(30_000);
    } finally {
      await fixture.cleanup();
    }
  });

  it("builds prompt-matched signatures in a hidden-message payload", async () => {
    const fixture = await createSettingsFixture({
      version: 1,
      defaultExposure: "match",
      maxMatchedTools: 1,
    });
    const runtime = createRuntimeStub(
      async () => [
        demoTool("list_issues", "List Linear issues"),
        demoTool("create_issue", "Create a Linear issue"),
      ],
      ["linear"],
    );

    try {
      const controller = createController(
        vi.fn().mockResolvedValue(runtime),
        fixture.agentDir,
      );
      const prepared = await controller.prepareTurn({
        prompt: "Please list my Linear issues",
        proxyActive: true,
        rootDir: fixture.rootDir,
      });

      expect(prepared.systemPromptAppend).toContain("`linear`");
      expect(prepared.matchedSelectors).toEqual(["linear.list_issues"]);
      expect(prepared.matchMessage).toContain("BEGIN UNTRUSTED MCP METADATA");
      expect(prepared.matchMessage).toContain("Input parameters");
      expect(runtime.listTools).toHaveBeenCalledWith(
        "linear",
        expect.objectContaining({
          includeSchema: true,
          autoAuthorize: false,
        }),
      );

      const imageOnly = await controller.prepareTurn({
        prompt: "",
        proxyActive: true,
        rootDir: fixture.rootDir,
      });
      expect(imageOnly.matchMessage).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it("skips a hidden match message whose content is already in context", async () => {
    const fixture = await createSettingsFixture({
      version: 1,
      defaultExposure: "match",
      maxMatchedTools: 1,
    });
    const runtime = createRuntimeStub(
      async () => [
        demoTool("list_issues", "List Linear issues"),
        demoTool("create_issue", "Create a Linear issue"),
      ],
      ["linear"],
    );

    try {
      const controller = createController(
        vi.fn().mockResolvedValue(runtime),
        fixture.agentDir,
      );
      const first = await controller.prepareTurn({
        prompt: "Please list my Linear issues",
        proxyActive: true,
        rootDir: fixture.rootDir,
      });
      const repeated = await controller.prepareTurn({
        prompt: "Please list my Linear issues",
        proxyActive: true,
        rootDir: fixture.rootDir,
      });
      const different = await controller.prepareTurn({
        prompt: "Create a new Linear issue",
        proxyActive: true,
        rootDir: fixture.rootDir,
      });

      expect(first.matchMessage).toContain("linear.list_issues");
      expect(repeated.matchMessage).toBeUndefined();
      expect(repeated.matchedSelectors).toEqual(first.matchedSelectors);
      expect(different.matchMessage).toContain("linear.create_issue");
    } finally {
      await fixture.cleanup();
    }
  });

  it("starts match discovery in the background at session start", async () => {
    const fixture = await createSettingsFixture({
      version: 1,
      defaultExposure: "match",
    });
    let resolveTools: ((tools: ServerToolInfo[]) => void) | undefined;
    const runtime = createRuntimeStub(
      () =>
        new Promise<ServerToolInfo[]>((resolve) => {
          resolveTools = resolve;
        }),
      ["demo"],
    );

    try {
      const controller = createController(
        vi.fn().mockResolvedValue(runtime),
        fixture.agentDir,
      );
      await expect(
        controller.startSession(fixture.rootDir, true),
      ).resolves.toEqual([]);
      expect(runtime.listTools).toHaveBeenCalledOnce();

      resolveTools?.([demoTool("lookup", "Look up data")]);
      await vi.waitFor(() => {
        expect(
          controller.catalogStore.getCachedToolsForServer("demo", {
            requireSchema: true,
          }),
        ).toHaveLength(1);
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("applies match filters without changing the proxy index", async () => {
    const fixture = await createSettingsFixture({
      version: 1,
      defaultExposure: "on-demand",
      servers: {
        demo: {
          exposure: "match",
          includeTools: ["get_*"],
          excludeTools: ["*_secret"],
        },
      },
    });
    const runtime = createRuntimeStub(
      async () => [
        demoTool("get_public", "Get public data"),
        demoTool("get_secret", "Get secret data"),
        demoTool("create_data", "Create data"),
      ],
      ["demo"],
    );

    try {
      const controller = createController(
        vi.fn().mockResolvedValue(runtime),
        fixture.agentDir,
      );
      const prepared = await controller.prepareTurn({
        prompt: "get public secret create data",
        proxyActive: true,
        rootDir: fixture.rootDir,
      });

      expect(prepared.systemPromptAppend).toContain("`demo`");
      expect(prepared.matchedSelectors).toEqual(["demo.get_public"]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("recreates the runtime and clears catalogs when cwd changes", async () => {
    const first = createRuntimeStub(
      async () => [demoTool("repo_a_lookup")],
      ["alpha"],
    );
    const second = createRuntimeStub(
      async () => [demoTool("repo_b_lookup")],
      ["alpha"],
    );
    const createRuntimeFn = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const controller = createController(createRuntimeFn);

    await controller.ensureRuntime("/repo-a");
    await controller.catalogStore.getBasicCatalog(first);
    await controller.ensureRuntime("/repo-b");

    expect(first.close).toHaveBeenCalledOnce();
    expect(
      controller.catalogStore.getCachedToolsForServer("alpha"),
    ).toBeUndefined();
  });

  it("formats status without starting a cold runtime", async () => {
    const createRuntimeFn = vi.fn();
    const controller = createController(createRuntimeFn);

    const status = await controller.formatStatus("/repo", true, {
      active: [],
      diagnostics: [],
      registered: [],
    });

    expect(status).toContain("Default exposure: index");
    expect(status).toContain("status does not start the runtime");
    expect(createRuntimeFn).not.toHaveBeenCalled();
  });
});

function createController(
  createRuntimeFn: ReturnType<typeof vi.fn>,
  agentDirectory?: string,
) {
  return createMcporterController({} as never, {
    agentDirectory: agentDirectory ?? "/__pi-mcporter-test-agent__",
    createRuntimeFn: createRuntimeFn as never,
    packageVersion: "1.0.0",
  });
}

function demoTool(name: string, description = name): ServerToolInfo {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  };
}

function createRuntimeStub(
  listTools: Runtime["listTools"] = vi.fn().mockResolvedValue([]),
  servers: string[] = [],
): Runtime & {
  close: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
} {
  const listToolsMock = vi.fn(listTools);
  return {
    listServers: () => servers,
    listTools: listToolsMock,
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
  } as unknown as Runtime & {
    close: ReturnType<typeof vi.fn>;
    listTools: ReturnType<typeof vi.fn>;
  };
}

async function createSettingsFixture(settings: unknown) {
  return await createSettingsFixtureRaw(JSON.stringify(settings));
}

async function createSettingsFixtureRaw(raw: string) {
  const directory = await mkdtemp(join(tmpdir(), "pi-mcporter-settings-"));
  const agentDir = join(directory, "agent");
  const rootDir = join(directory, "repo");
  await mkdir(agentDir, { recursive: true });
  await mkdir(rootDir, { recursive: true });
  const globalPath = join(agentDir, "mcporter.json");
  await writeFile(globalPath, raw, "utf8");

  return {
    agentDir,
    rootDir,
    async writeGlobal(settings: unknown) {
      await writeFile(globalPath, JSON.stringify(settings), "utf8");
    },
    async cleanup() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}
