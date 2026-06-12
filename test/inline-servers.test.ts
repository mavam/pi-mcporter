import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildInlineServerDefinition,
  hasInlineDefinition,
  registerInlineServers,
} from "../src/inline-servers.ts";

const BASE_DIR = "/home/tester/.pi/agent";

describe("hasInlineDefinition", () => {
  it("detects inline entries by command or url", () => {
    expect(hasInlineDefinition({ command: "npx -y demo" })).toBe(true);
    expect(hasInlineDefinition({ url: "https://example.com/mcp" })).toBe(true);
    expect(hasInlineDefinition({ env: { TOKEN: "literal" } })).toBe(false);
    expect(hasInlineDefinition({ mode: "preload" })).toBe(false);
  });
});

describe("buildInlineServerDefinition", () => {
  describe("stdio", () => {
    it("tokenizes a string command", () => {
      expect(
        buildInlineServerDefinition(
          "demo",
          { command: "npx -y demo-server" },
          BASE_DIR,
        ).command,
      ).toEqual({
        kind: "stdio",
        command: "npx",
        args: ["-y", "demo-server"],
        cwd: BASE_DIR,
      });
    });

    it("honors quotes and escapes when tokenizing", () => {
      expect(
        buildInlineServerDefinition(
          "demo",
          { command: `run "two words" 'single quoted' escaped\\ space` },
          BASE_DIR,
        ).command,
      ).toEqual({
        kind: "stdio",
        command: "run",
        args: ["two words", "single quoted", "escaped space"],
        cwd: BASE_DIR,
      });
    });

    it("keeps a string command verbatim when args are explicit", () => {
      expect(
        buildInlineServerDefinition(
          "demo",
          { command: "npx", args: ["-y", "demo server"] },
          BASE_DIR,
        ).command,
      ).toEqual({
        kind: "stdio",
        command: "npx",
        args: ["-y", "demo server"],
        cwd: BASE_DIR,
      });
    });

    it("splits an array command into command and args", () => {
      expect(
        buildInlineServerDefinition(
          "demo",
          { command: ["npx", "-y", "demo-server"] },
          BASE_DIR,
        ).command,
      ).toEqual({
        kind: "stdio",
        command: "npx",
        args: ["-y", "demo-server"],
        cwd: BASE_DIR,
      });
    });

    it("prefers an explicit cwd and expands the home prefix", () => {
      expect(
        buildInlineServerDefinition(
          "demo",
          { command: "demo-server", cwd: "~/servers" },
          BASE_DIR,
        ).command,
      ).toMatchObject({ cwd: join(homedir(), "servers") });
      expect(
        buildInlineServerDefinition(
          "demo",
          { command: "demo-server", cwd: "/srv" },
          BASE_DIR,
        ).command,
      ).toMatchObject({ cwd: "/srv" });
    });

    it("rejects commands that tokenize to nothing", () => {
      expect(() =>
        buildInlineServerDefinition("demo", { command: "''" }, BASE_DIR),
      ).toThrow("Empty command for mcporter mcpServers.demo.command.");
    });
  });

  describe("http", () => {
    it("builds an http command with the default accept header", () => {
      expect(
        buildInlineServerDefinition(
          "demo",
          { url: "https://example.com/mcp" },
          BASE_DIR,
        ).command,
      ).toEqual({
        kind: "http",
        url: new URL("https://example.com/mcp"),
        headers: { accept: "application/json, text/event-stream" },
      });
    });

    it("keeps an accept header that already covers both content types", () => {
      expect(
        buildInlineServerDefinition(
          "demo",
          {
            url: "https://example.com/mcp",
            headers: { Accept: "application/json, text/event-stream" },
          },
          BASE_DIR,
        ).command,
      ).toMatchObject({
        headers: { Accept: "application/json, text/event-stream" },
      });
    });

    it("wins over a command when both are present", () => {
      expect(
        buildInlineServerDefinition(
          "demo",
          { url: "https://example.com/mcp", command: "demo-server" },
          BASE_DIR,
        ).command,
      ).toMatchObject({ kind: "http" });
    });

    it("rejects invalid URLs", () => {
      expect(() =>
        buildInlineServerDefinition("demo", { url: "not a url" }, BASE_DIR),
      ).toThrow("Invalid URL 'not a url' for mcporter mcpServers.demo.url.");
    });

    describe("header secret resolution", () => {
      const previousToken = process.env.DEMO_BEARER_TOKEN;

      afterEach(() => {
        if (previousToken === undefined) {
          delete process.env.DEMO_BEARER_TOKEN;
        } else {
          process.env.DEMO_BEARER_TOKEN = previousToken;
        }
      });

      it("resolves $env references in header values", () => {
        process.env.DEMO_BEARER_TOKEN = "secret-token";
        expect(
          buildInlineServerDefinition(
            "demo",
            {
              url: "https://example.com/mcp",
              headers: {
                Authorization: "Bearer literal",
                "X-Token": "$env:DEMO_BEARER_TOKEN",
              },
            },
            BASE_DIR,
          ).command,
        ).toMatchObject({
          headers: {
            Authorization: "Bearer literal",
            "X-Token": "secret-token",
          },
        });
      });

      it("fails when a referenced header env variable is missing", () => {
        delete process.env.DEMO_BEARER_TOKEN;
        expect(() =>
          buildInlineServerDefinition(
            "demo",
            {
              url: "https://example.com/mcp",
              headers: { "X-Token": "$env:DEMO_BEARER_TOKEN" },
            },
            BASE_DIR,
          ),
        ).toThrow(
          "Environment variable 'DEMO_BEARER_TOKEN' is required for mcporter mcpServers.demo.headers.X-Token.",
        );
      });
    });
  });

  it("never sets env on the built definition", () => {
    expect(
      buildInlineServerDefinition(
        "demo",
        { command: "demo-server", env: { TOKEN: "literal" } },
        BASE_DIR,
      ).env,
    ).toBeUndefined();
  });
});

describe("registerInlineServers", () => {
  it("registers only inline entries and overwrites existing names", () => {
    const registered: { name: string; overwrite?: boolean }[] = [];
    registerInlineServers(
      {
        registerDefinition: (definition, options) => {
          registered.push({ name: definition.name, ...options });
        },
      },
      {
        inline: { command: "demo-server" },
        overlay: { env: { TOKEN: "literal" } },
      },
      BASE_DIR,
    );

    expect(registered).toEqual([{ name: "inline", overwrite: true }]);
  });
});
