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
        mcpServers: {
          excalidraw: {
            env: {
              EXCALIDRAW_API_KEY:
                "!security find-generic-password -s excalidraw-api-key -w",
              IGNORED: 42,
            },
            mode: "PRELOAD",
          },
          ignored: 42,
        },
        timeoutMs: 45_000,
        mode: "PRELOAD",
      }),
    ).toEqual({
      configPath: "/tmp/mcporter.json",
      mcpServers: {
        excalidraw: {
          env: {
            EXCALIDRAW_API_KEY:
              "!security find-generic-password -s excalidraw-api-key -w",
          },
          mode: "preload",
        },
      },
      timeoutMs: 45_000,
      mode: "preload",
    });
  });

  it("keeps server entries that only set a mode", () => {
    expect(
      normalizeMcporterSettings({
        mcpServers: {
          linear: { mode: "preload" },
        },
      }).mcpServers,
    ).toEqual({
      linear: { mode: "preload" },
    });
  });

  it("keeps inline server definitions", () => {
    expect(
      normalizeMcporterSettings({
        mcpServers: {
          stdio: { command: "npx -y demo-server", cwd: " /srv " },
          stdioArray: { command: ["npx", "-y", "demo-server"] },
          http: {
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer token" },
          },
        },
      }).mcpServers,
    ).toEqual({
      stdio: { command: "npx -y demo-server", cwd: "/srv" },
      stdioArray: { command: ["npx", "-y", "demo-server"] },
      http: {
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token" },
      },
    });
  });

  it("drops malformed inline fields and field-only entries", () => {
    expect(
      normalizeMcporterSettings({
        mcpServers: {
          demo: {
            command: ["npx", 42],
            url: "   ",
            mode: "preload",
          },
          headersOnly: { headers: { Authorization: "Bearer token" } },
        },
      }).mcpServers,
    ).toEqual({
      demo: { mode: "preload" },
    });
  });

  it("drops invalid per-server modes so the global mode applies", () => {
    expect(
      normalizeMcporterSettings({
        mcpServers: {
          linear: { mode: "surprise" },
          slack: { env: { TOKEN: "literal" }, mode: "surprise" },
        },
        mode: "preload",
      }),
    ).toEqual({
      configPath: undefined,
      mcpServers: {
        slack: { env: { TOKEN: "literal" } },
      },
      timeoutMs: 30_000,
      mode: "preload",
    });
  });

  it("falls back to defaults for invalid scalar values", () => {
    expect(
      normalizeMcporterSettings({
        configPath: "   ",
        timeoutMs: "wat",
        mode: "surprise",
      }),
    ).toEqual({
      configPath: undefined,
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

  it("loads resolved config with effective runtime config path and server env overlay", async () => {
    const config = await loadResolvedMcporterConfig({
      homeDirectory: "/home/tester",
      env: { MCPORTER_CONFIG: "/env/mcporter.json" },
      async readFileFn() {
        return JSON.stringify({
          configPath: "/settings/mcporter.json",
          mcpServers: {
            demo: {
              env: {
                PLAIN_TOKEN: "literal-token",
                COMMAND_TOKEN:
                  "!node -e \"process.stdout.write('command-token\\n')\"",
              },
            },
          },
          timeoutMs: 45_000,
          mode: "preload",
        });
      },
    });

    expect(config).toEqual({
      configPath: "/settings/mcporter.json",
      mcpServers: {
        demo: {
          env: {
            PLAIN_TOKEN: "literal-token",
            COMMAND_TOKEN:
              "!node -e \"process.stdout.write('command-token\\n')\"",
          },
        },
      },
      runtimeConfigPath: "/env/mcporter.json",
      settingsPath: "/home/tester/.pi/agent/mcporter.json",
      timeoutMs: 45_000,
      mode: "preload",
    });
  });

  it("uses MCPORTER_CONFIG when the settings file is malformed", async () => {
    const config = await loadResolvedMcporterConfig({
      homeDirectory: "/home/tester",
      env: { MCPORTER_CONFIG: "/env/mcporter.json" },
      async readFileFn() {
        return '{"mode":"preload"';
      },
    });

    expect(config).toEqual({
      runtimeConfigPath: "/env/mcporter.json",
      settingsPath: "/home/tester/.pi/agent/mcporter.json",
      timeoutMs: 30_000,
      mode: "index",
    });
  });
});
