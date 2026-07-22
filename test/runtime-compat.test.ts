import { readFile } from "node:fs/promises";
import { createRuntime } from "mcporter";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  dependencies?: Record<string, string>;
  engines?: Record<string, string>;
};

type PackageLock = {
  packages?: Record<
    string,
    {
      version?: string;
    }
  >;
};

describe("MCPorter runtime compatibility", () => {
  it("requires the OAuth-compatible MCPorter release line", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as PackageManifest;
    const lock = JSON.parse(
      await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
    ) as PackageLock;

    expect(manifest.dependencies?.mcporter).toBe("^0.12.3");
    expect(lock.packages?.["node_modules/mcporter"]?.version).toBe("0.12.3");
    expect(manifest.engines?.node).toBe(">=24");
  });

  it("creates a runtime through the current installed API", async () => {
    const runtime = await createRuntime({ servers: [] });

    try {
      expect(runtime.listServers()).toEqual([]);
      expect(runtime.callTool).toBeTypeOf("function");
      expect(runtime.close).toBeTypeOf("function");
    } finally {
      await runtime.close();
    }
  });
});
