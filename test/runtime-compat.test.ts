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

const MINIMUM_MCPORTER_VERSION = [0, 13, 0] as const;

function parseVersion(version: string | undefined): [number, number, number] {
  const match = version?.match(/\d+\.\d+\.\d+/);
  if (!match) {
    throw new Error(
      `Expected a semantic version, received ${version ?? "undefined"}`,
    );
  }
  return match[0].split(".").map(Number) as [number, number, number];
}

function isAtLeast(
  actual: readonly number[],
  minimum: readonly number[],
): boolean {
  for (const [index, component] of actual.entries()) {
    if (component !== minimum[index]) {
      return component > minimum[index];
    }
  }
  return true;
}

describe("MCPorter runtime compatibility", () => {
  it("requires the secure MCPorter release line", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as PackageManifest;
    const lock = JSON.parse(
      await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
    ) as PackageLock;

    expect(
      isAtLeast(
        parseVersion(manifest.dependencies?.mcporter),
        MINIMUM_MCPORTER_VERSION,
      ),
    ).toBe(true);
    expect(
      isAtLeast(
        parseVersion(lock.packages?.["node_modules/mcporter"]?.version),
        MINIMUM_MCPORTER_VERSION,
      ),
    ).toBe(true);
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
