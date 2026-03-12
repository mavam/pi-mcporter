import { describe, expect, it } from "vitest";
import {
  getDefaultMcporterSettings,
  loadResolvedMcporterConfig,
  loadMcporterSettings,
  normalizeMcporterSettings,
  resolveMcporterConfig,
  resolveMcporterSettingsPath,
  resolveRuntimeConfigPath,
} from "../src/settings.ts";

describe("mcporter settings", () => {
  it("uses the standard pi agent settings path", () => {
    expect(resolveMcporterSettingsPath("/home/tester")).toBe(
      "/home/tester/.pi/agent/mcporter.json",
    );
  });

  it("returns defaults when the settings file is missing", async () => {
    const settings = await loadMcporterSettings({
      homeDirectory: "/home/tester",
      async readFileFn() {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    });

    expect(settings).toEqual(getDefaultMcporterSettings());
  });

  it("resolves env config path ahead of settings configPath", () => {
    expect(
      resolveRuntimeConfigPath(
        {
          ...getDefaultMcporterSettings(),
          configPath: "/settings/mcporter.json",
        },
        { MCPORTER_CONFIG: " /env/mcporter.json " },
      ),
    ).toBe("/env/mcporter.json");
  });

  it("uses settings configPath when MCPORTER_CONFIG is unset", () => {
    expect(
      resolveMcporterConfig({
        ...getDefaultMcporterSettings(),
        configPath: "/settings/mcporter.json",
      }).runtimeConfigPath,
    ).toBe("/settings/mcporter.json");
  });

  it("normalizes supported settings fields", () => {
    expect(
      normalizeMcporterSettings({
        configPath: "  /tmp/mcporter.json  ",
        timeoutMs: 45_000,
        mode: "DIRECT",
        serverModes: {
          linear: "preload",
          slack: "LAZY",
        },
      }),
    ).toEqual({
      configPath: "/tmp/mcporter.json",
      timeoutMs: 45_000,
      mode: "direct",
      serverModes: {
        linear: "preload",
        slack: "lazy",
      },
    });
  });

  it("falls back to defaults for invalid scalar values", () => {
    expect(
      normalizeMcporterSettings({
        configPath: "   ",
        timeoutMs: "wat",
        mode: "surprise",
        serverModes: {
          linear: "surprise",
          "   ": "direct",
          github: 123,
        },
      }),
    ).toEqual({
      configPath: undefined,
      timeoutMs: 30_000,
      mode: "lazy",
      serverModes: {},
    });
  });

  it("ignores invalid per-server modes while preserving valid overrides", () => {
    expect(
      normalizeMcporterSettings({
        mode: "direct",
        serverModes: {
          linear: "preload",
          slack: "surprise",
          github: " lazy ",
        },
      }),
    ).toEqual({
      configPath: undefined,
      timeoutMs: 30_000,
      mode: "direct",
      serverModes: {
        linear: "preload",
        github: "lazy",
      },
    });
  });

  it("accepts legacy eager and hoist aliases", () => {
    expect(
      normalizeMcporterSettings({
        mode: "hoist",
        serverModes: {
          linear: "eager",
        },
      }),
    ).toEqual({
      configPath: undefined,
      timeoutMs: 30_000,
      mode: "direct",
      serverModes: {
        linear: "preload",
      },
    });
  });

  it("fails for non-object settings content", async () => {
    await expect(
      loadMcporterSettings({
        homeDirectory: "/home/tester",
        async readFileFn() {
          return '["nope"]';
        },
      }),
    ).rejects.toThrow(
      "Failed to load /home/tester/.pi/agent/mcporter.json: Expected a top-level JSON object.",
    );
  });

  it("loads resolved config with effective runtime config path", async () => {
    const config = await loadResolvedMcporterConfig({
      homeDirectory: "/home/tester",
      env: { MCPORTER_CONFIG: "/env/mcporter.json" },
      async readFileFn() {
        return JSON.stringify({
          configPath: "/settings/mcporter.json",
          timeoutMs: 45_000,
          mode: "direct",
        });
      },
    });

    expect(config).toEqual({
      configPath: "/settings/mcporter.json",
      runtimeConfigPath: "/env/mcporter.json",
      settingsPath: "/home/tester/.pi/agent/mcporter.json",
      timeoutMs: 45_000,
      mode: "direct",
      serverModes: {},
    });
  });
});
