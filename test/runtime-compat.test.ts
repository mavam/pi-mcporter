import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRuntime } from "mcporter";
import { describe, expect, it } from "vitest";
import { silenceMcporterStdioLogs } from "../src/mcporter-stdio-logging.js";

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

type McporterStdioLogMode = "auto" | "always" | "silent";

type McporterStdioLoggingModule = {
  getStdioLogMode(): McporterStdioLogMode;
  setStdioLogMode(mode: McporterStdioLogMode): McporterStdioLogMode;
};

const MINIMUM_MCPORTER_VERSION = [0, 13, 0] as const;

const FIXTURE_RESULT_PREFIX = "__FIXTURE_RESULT__";
const FIXTURE_TIMEOUT_MS = 60_000;

type ProbeFixtureResult =
  | { ok: true; tools: string[] }
  | { ok: false; error: string };

type ProbeFixtureRun = {
  stdout: string;
  result: ProbeFixtureResult;
};

// Runs the legacy-negotiation fixture in its own process so the assertions can
// observe every byte that MCPorter writes to that process's stdout.
async function runProbeFixture(options: {
  silence: boolean;
}): Promise<ProbeFixtureRun> {
  const fixture = fileURLToPath(
    new URL("./fixtures/legacy-negotiation-probe.mjs", import.meta.url),
  );
  const env = { ...process.env };
  delete env.MCPORTER_STDIO_LOGS;
  delete env.MCPORTER_STDIO_TRACE;
  delete env.MCPORTER_LOG_LEVEL;
  if (!options.silence) {
    env.FIXTURE_SILENCE_STDIO_LOGS = "0";
  }

  const child = spawn(process.execPath, [fixture], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve());
  });

  const marker = stderr
    .split("\n")
    .find((line) => line.startsWith(FIXTURE_RESULT_PREFIX));
  if (!marker) {
    throw new Error(`Fixture reported no result. stderr: ${stderr}`);
  }

  return {
    stdout,
    result: JSON.parse(
      marker.slice(FIXTURE_RESULT_PREFIX.length),
    ) as ProbeFixtureResult,
  };
}

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

  it("silences direct stdio diagnostics for embedded runtimes", async () => {
    const entrypoint = import.meta.resolve("mcporter");
    const loggingUrl = new URL("./sdk-stdio-logging.js", entrypoint);
    const logging = (await import(
      loggingUrl.href
    )) as McporterStdioLoggingModule;
    const previous = logging.setStdioLogMode("auto");

    try {
      await silenceMcporterStdioLogs();
      expect(logging.getStdioLogMode()).toBe("silent");
    } finally {
      logging.setStdioLogMode(previous);
    }
  });

  it(
    "keeps stdout clean while legacy stdio negotiation falls back",
    async () => {
      const run = await runProbeFixture({ silence: true });

      expect(run.result).toEqual({ ok: true, tools: ["echo"] });
      expect(run.stdout).toBe("");
    },
    FIXTURE_TIMEOUT_MS,
  );

  it(
    "reproduces the stdout writes that the silencer suppresses",
    async () => {
      const run = await runProbeFixture({ silence: false });

      expect(run.result).toEqual({ ok: true, tools: ["echo"] });
      expect(run.stdout).toContain("[mcporter] stderr from");
      expect(run.stdout).toContain("unsupported request server/discover");
    },
    FIXTURE_TIMEOUT_MS,
  );

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
