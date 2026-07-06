import { describe, expect, it } from "vitest";
import {
  getDefaultMcporterSettings,
  loadResolvedMcporterConfig,
  loadMcporterSettings,
  normalizeMcporterSettings,
  resolveMcporterSettingsPath,
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

  it("normalizes high-level settings fields", () => {
    expect(
      normalizeMcporterSettings({
        timeoutMs: 45_000,
        mode: "PRELOAD",
        serverModes: {
          linear: "PRELOAD",
          playwright: { mode: "lazy" },
          ignored: "surprise",
        },
      }),
    ).toEqual({
      timeoutMs: 45_000,
      mode: "preload",
      serverModes: {
        linear: "preload",
        playwright: "lazy",
      },
    });
  });

  it("accepts legacy mcpServers entries only for per-server mode migration", () => {
    expect(
      normalizeMcporterSettings({
        mcpServers: {
          linear: { mode: "preload" },
          ignoredEnvOnly: { env: { TOKEN: "literal" } },
          ignoredInline: { command: "npx -y demo-server" },
        },
      }),
    ).toEqual({
      mode: "index",
      serverModes: {
        linear: "preload",
      },
      timeoutMs: 30_000,
    });
  });

  it("lets serverModes win over legacy mcpServers mode entries", () => {
    expect(
      normalizeMcporterSettings({
        mcpServers: { linear: { mode: "lazy" } },
        serverModes: { linear: "preload" },
      }).serverModes,
    ).toEqual({ linear: "preload" });
  });

  it("drops invalid per-server modes so the global mode applies", () => {
    expect(
      normalizeMcporterSettings({
        serverModes: {
          linear: "surprise",
          slack: { mode: "surprise" },
        },
        mode: "preload",
      }),
    ).toEqual({
      timeoutMs: 30_000,
      mode: "preload",
    });
  });

  it("falls back to defaults for invalid scalar values", () => {
    expect(
      normalizeMcporterSettings({
        configPath: "ignored-by-pi-mcporter",
        timeoutMs: "wat",
        mode: "surprise",
      }),
    ).toEqual({
      timeoutMs: 30_000,
      mode: "index",
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

  it("loads resolved high-level config with settings path", async () => {
    const config = await loadResolvedMcporterConfig({
      homeDirectory: "/home/tester",
      async readFileFn() {
        return JSON.stringify({
          timeoutMs: 45_000,
          mode: "preload",
          serverModes: { demo: "lazy" },
        });
      },
    });

    expect(config).toEqual({
      settingsPath: "/home/tester/.pi/agent/mcporter.json",
      timeoutMs: 45_000,
      mode: "preload",
      serverModes: { demo: "lazy" },
    });
  });
});
