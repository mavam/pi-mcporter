// Connects an embedded MCPorter runtime to the fake legacy stdio server in a
// dedicated process so a test can observe this process's stdout. Set
// FIXTURE_SILENCE_STDIO_LOGS=0 to skip the silencer and reproduce MCPorter's
// default stdout behavior.
import { fileURLToPath } from "node:url";
import { createRuntime } from "mcporter";

if (process.env.FIXTURE_SILENCE_STDIO_LOGS !== "0") {
  const { silenceMcporterStdioLogs } = await import(
    new URL("../../src/mcporter-stdio-logging.ts", import.meta.url).href
  );
  await silenceMcporterStdioLogs();
}

const serverPath = fileURLToPath(
  new URL("./legacy-stdio-server.mjs", import.meta.url),
);

const runtime = await createRuntime({
  servers: [
    {
      name: "legacy",
      command: {
        kind: "stdio",
        command: process.execPath,
        args: [serverPath],
        cwd: process.cwd(),
      },
    },
  ],
  clientInfo: { name: "pi-mcporter-test", version: "0.0.0" },
});

let result;
try {
  const tools = await runtime.listTools("legacy", {
    includeSchema: false,
    disableOAuth: true,
  });
  result = { ok: true, tools: tools.map((tool) => tool.name) };
} catch (error) {
  result = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
} finally {
  await runtime.close().catch(() => {});
}

process.stderr.write(`__FIXTURE_RESULT__${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
