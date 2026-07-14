import { describe, expect, it } from "vitest";
import {
  getDefaultMcporterSettings,
  loadResolvedMcporterConfig,
  normalizeMcporterSettings,
  resolveMcporterSettingsPaths,
} from "../src/settings.ts";

describe("mcporter settings", () => {
  it("uses Pi's agent directory and the project .pi directory", () => {
    expect(resolveMcporterSettingsPaths("/repo", "/agent")).toEqual({
      globalPath: "/agent/mcporter.json",
      projectPath: "/repo/.pi/mcporter.json",
    });
  });

  it("returns versioned defaults when both files are missing", async () => {
    const config = await loadResolvedMcporterConfig({
      agentDirectory: "/agent",
      rootDir: "/repo",
      readFileFn: missingFiles,
    });

    expect(config).toMatchObject({
      ...getDefaultMcporterSettings(),
      globalPath: "/agent/mcporter.json",
      projectPath: "/repo/.pi/mcporter.json",
      loadedPaths: [],
    });
    expect(config.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("normalizes the complete schema", () => {
    expect(
      normalizeMcporterSettings({
        version: 1,
        defaultExposure: "match",
        callTimeoutMs: 45_000,
        discoveryTimeoutMs: 1_500,
        maxMatchedTools: 12,
        servers: {
          linear: {
            exposure: "native",
            includeTools: ["list_*", "create_issue"],
            excludeTools: ["*_admin"],
          },
          slack: { exposure: "on-demand" },
        },
      }),
    ).toEqual({
      version: 1,
      defaultExposure: "match",
      callTimeoutMs: 45_000,
      discoveryTimeoutMs: 1_500,
      maxMatchedTools: 12,
      servers: {
        linear: {
          exposure: "native",
          includeTools: ["list_*", "create_issue"],
          excludeTools: ["*_admin"],
        },
        slack: { exposure: "on-demand" },
      },
    });
  });

  it("treats every server name as an own data key", () => {
    const settings = normalizeMcporterSettings(
      JSON.parse('{"version":1,"servers":{"__proto__":{"exposure":"index"}}}'),
    );

    expect(Object.hasOwn(settings.servers, "__proto__")).toBe(true);
    expect(settings.servers.__proto__).toEqual({ exposure: "index" });
    expect(Object.getPrototypeOf(settings.servers)).toBe(Object.prototype);
  });

  it("layers scalars while replacing whole server entries", async () => {
    const files = new Map([
      [
        "/agent/mcporter.json",
        JSON.stringify({
          version: 1,
          defaultExposure: "match",
          callTimeoutMs: 40_000,
          servers: {
            linear: {
              exposure: "native",
              includeTools: ["list_*"],
              excludeTools: ["list_private"],
            },
            slack: { exposure: "index" },
          },
        }),
      ],
      [
        "/repo/.pi/mcporter.json",
        JSON.stringify({
          version: 1,
          discoveryTimeoutMs: 3_000,
          servers: {
            linear: { exposure: "match", includeTools: ["get_*"] },
            slack: null,
          },
        }),
      ],
    ]);

    const config = await loadResolvedMcporterConfig({
      agentDirectory: "/agent",
      rootDir: "/repo",
      readFileFn: fileReader(files),
    });

    expect(config).toMatchObject({
      defaultExposure: "match",
      callTimeoutMs: 40_000,
      discoveryTimeoutMs: 3_000,
      servers: {
        linear: { exposure: "match", includeTools: ["get_*"] },
      },
      loadedPaths: ["/agent/mcporter.json", "/repo/.pi/mcporter.json"],
    });
    expect(config.servers.slack).toBeUndefined();
    expect(config.servers.linear?.excludeTools).toBeUndefined();
  });

  it.each([
    [{ defaultExposure: "index" }, "version must be 1"],
    [{ version: 2 }, "version must be 1"],
    [{ version: 1, mode: "index" }, "unknown key(s): mode"],
    [
      { version: 1, defaultExposure: "native" },
      "defaultExposure must be 'on-demand', 'index', or 'match'",
    ],
    [
      { version: 1, discoveryTimeoutMs: 50 },
      "discoveryTimeoutMs must be an integer between 100 and 30000",
    ],
    [
      { version: 1, callTimeoutMs: 300_001 },
      "callTimeoutMs must be an integer between 1 and 300000",
    ],
    [
      { version: 1, maxMatchedTools: 51 },
      "maxMatchedTools must be an integer between 1 and 50",
    ],
    [
      {
        version: 1,
        servers: { linear: { exposure: "native" } },
      },
      "native exposure requires a non-empty includeTools array",
    ],
    [
      {
        version: 1,
        servers: {
          linear: { exposure: "index", includeTools: ["*"] },
        },
      },
      "tool filters are only valid for 'match' or 'native' exposure",
    ],
  ])("rejects invalid configuration %#", (value, message) => {
    expect(() => normalizeMcporterSettings(value)).toThrow(message);
  });

  it("treats an invalid project layer as fatal to enrichment", async () => {
    const files = new Map([
      ["/agent/mcporter.json", JSON.stringify({ version: 1 })],
      [
        "/repo/.pi/mcporter.json",
        JSON.stringify({ version: 1, futureOption: true }),
      ],
    ]);

    await expect(
      loadResolvedMcporterConfig({
        agentDirectory: "/agent",
        rootDir: "/repo",
        readFileFn: fileReader(files),
      }),
    ).rejects.toThrow("/repo/.pi/mcporter.json: unknown key(s): futureOption");
  });

  it("rejects a present file whose JSON value is null", async () => {
    await expect(
      loadResolvedMcporterConfig({
        agentDirectory: "/agent",
        rootDir: "/repo",
        readFileFn: fileReader(new Map([["/agent/mcporter.json", "null"]])),
      }),
    ).rejects.toThrow("/agent/mcporter.json: expected a top-level JSON object");
  });
});

function fileReader(files: Map<string, string>) {
  return async (path: string): Promise<string> => {
    const contents = files.get(path);
    if (contents !== undefined) return contents;
    return await missingFiles();
  };
}

async function missingFiles(): Promise<never> {
  const error = new Error("missing") as NodeJS.ErrnoException;
  error.code = "ENOENT";
  throw error;
}
