import { execFileSync } from "node:child_process";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import type { McporterServerSettings } from "./settings.js";

const SECRET_COMMAND_TIMEOUT_MS = 10_000;

const ENV_DIRECT_PATTERN = /^\$env:([A-Za-z_][A-Za-z0-9_]*)$/;
const ENV_BRACED_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

type RuntimeWithDefinitions = {
  getDefinition(server: string): RuntimeServerDefinition;
  registerDefinition(
    definition: RuntimeServerDefinition,
    options?: { overwrite?: boolean },
  ): void;
};

type RuntimeServerDefinition = {
  readonly env?: Record<string, string>;
};

export function resolveServerEnv(
  serverName: string,
  settings: McporterServerSettings | undefined,
): Record<string, string> | undefined {
  if (!settings?.env) {
    return undefined;
  }

  const resolved = Object.fromEntries(
    Object.entries(settings.env).map(([key, value]) => [
      key,
      resolveConfigValue(value, `mcporter mcpServers.${serverName}.env.${key}`),
    ]),
  );
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

export function attachSecretEnvToRuntime(
  runtime: RuntimeWithDefinitions,
  mcpServers: Record<string, McporterServerSettings> | undefined,
): void {
  if (!mcpServers) {
    return;
  }

  for (const [serverName, settings] of Object.entries(mcpServers)) {
    const env = resolveServerEnv(serverName, settings);
    if (!env) {
      continue;
    }

    const definition = runtime.getDefinition(serverName);
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

  const directMatch = ENV_DIRECT_PATTERN.exec(value);
  const bracedMatch = ENV_BRACED_PATTERN.exec(value);
  const envName = directMatch?.[1] ?? bracedMatch?.[1];
  if (envName) {
    return requireProcessEnv(envName, description);
  }

  return value;
}

function requireProcessEnv(envName: string, description: string): string {
  const value = process.env[envName];
  if (value === undefined) {
    throw new Error(
      `Environment variable '${envName}' is required for ${description}.`,
    );
  }
  return value;
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
