import { execFileSync } from "node:child_process";
import { getShellConfig } from "@earendil-works/pi-coding-agent";

const SECRET_COMMAND_TIMEOUT_MS = 10_000;

type RuntimeWithDefinitions = {
  getDefinitions(): RuntimeServerDefinition[];
  registerDefinition(
    definition: RuntimeServerDefinition,
    options?: { overwrite?: boolean },
  ): void;
};

type RuntimeServerDefinition = {
  readonly env?: Record<string, string>;
};

export function resolveSecretEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }

  const resolved = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      resolveConfigValue(value, `mcporter env.${key}`),
    ]),
  );
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

export function attachSecretEnvToRuntime(
  runtime: RuntimeWithDefinitions,
  env: Record<string, string> | undefined,
): void {
  if (!env) {
    return;
  }

  for (const definition of runtime.getDefinitions()) {
    runtime.registerDefinition(
      {
        ...definition,
        env: {
          ...env,
          ...definition.env,
        },
      },
      { overwrite: true },
    );
  }
}

function resolveConfigValue(value: string, description: string): string {
  if (value.startsWith("!")) {
    return executeSecretCommand(value.slice(1), description);
  }

  return process.env[value] || value;
}

function executeSecretCommand(command: string, description: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error(`Empty command for ${description}.`);
  }

  try {
    const shell = getShellConfig();
    return execFileSync(shell.shell, [...shell.args, trimmed], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: SECRET_COMMAND_TIMEOUT_MS,
      windowsHide: true,
    }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to resolve ${description}: ${message}`);
  }
}
