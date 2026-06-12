import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CALL_TIMEOUT_MS } from "./constants.js";
import { isPlainObject, toErrorMessage } from "./helpers.js";
import { resolveCallTimeoutFromInputs } from "./inputs.js";
import {
  parseMcporterMode,
  resolveMcporterMode,
  type McporterMode,
} from "./mode.js";

export type McporterServerSettings = {
  args?: string[];
  command?: string | string[];
  cwd?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  mode?: McporterMode;
  url?: string;
};

export type McporterSettings = {
  configPath?: string;
  mcpServers?: Record<string, McporterServerSettings>;
  mode: McporterMode;
  timeoutMs: number;
};

export type ResolvedMcporterConfig = McporterSettings & {
  runtimeConfigPath?: string;
  settingsPath: string;
};

type SettingsLoaderOptions = {
  homeDirectory?: string;
  env?: NodeJS.ProcessEnv;
  readFileFn?: (path: string, encoding: "utf8") => Promise<string>;
};

export function getDefaultMcporterSettings(): McporterSettings {
  return {
    mode: "index",
    timeoutMs: DEFAULT_CALL_TIMEOUT_MS,
  };
}

export function resolveMcporterSettingsPath(homeDirectory = homedir()): string {
  return join(homeDirectory, ".pi", "agent", "mcporter.json");
}

export function normalizeMcporterSettings(value: unknown): McporterSettings {
  if (!isPlainObject(value)) {
    throw new Error("Expected a top-level JSON object.");
  }

  const defaults = getDefaultMcporterSettings();
  const configPath = normalizeConfigPath(value.configPath);
  const mcpServers = normalizeMcpServers(value.mcpServers);
  const timeoutMs = normalizeTimeoutMs(value.timeoutMs);
  const mode =
    typeof value.mode === "string"
      ? resolveMcporterMode(value.mode)
      : defaults.mode;

  return {
    configPath,
    ...(mcpServers ? { mcpServers } : {}),
    mode,
    timeoutMs,
  };
}

export async function loadMcporterSettings(
  options: SettingsLoaderOptions = {},
): Promise<McporterSettings> {
  const readFileFn = options.readFileFn ?? readFile;
  const settingsPath = resolveMcporterSettingsPath(options.homeDirectory);

  try {
    const raw = await readFileFn(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeMcporterSettings(parsed);
  } catch (error) {
    if (isMissingFileError(error)) {
      return getDefaultMcporterSettings();
    }
    throw new Error(`Failed to load ${settingsPath}: ${toErrorMessage(error)}`);
  }
}

export async function loadResolvedMcporterConfig(
  options: SettingsLoaderOptions = {},
): Promise<ResolvedMcporterConfig> {
  try {
    const settings = await loadMcporterSettings(options);
    return resolveMcporterConfig(settings, {
      env: options.env,
      homeDirectory: options.homeDirectory,
    });
  } catch (error) {
    const runtimeConfigPath = resolveRuntimeConfigPath(
      getDefaultMcporterSettings(),
      options.env,
    );
    if (!runtimeConfigPath) {
      throw error;
    }

    return {
      ...getDefaultMcporterSettings(),
      runtimeConfigPath,
      settingsPath: resolveMcporterSettingsPath(options.homeDirectory),
    };
  }
}

export function resolveMcporterConfig(
  settings: McporterSettings,
  options: {
    env?: NodeJS.ProcessEnv;
    homeDirectory?: string;
  } = {},
): ResolvedMcporterConfig {
  return {
    ...settings,
    runtimeConfigPath: resolveRuntimeConfigPath(settings, options.env),
    settingsPath: resolveMcporterSettingsPath(options.homeDirectory),
  };
}

export function resolveRuntimeConfigPath(
  settings: Pick<McporterSettings, "configPath">,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const envPath = normalizeConfigPath(env.MCPORTER_CONFIG);
  if (envPath) {
    return envPath;
  }

  return settings.configPath;
}

function normalizeConfigPath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeMcpServers(
  value: unknown,
): Record<string, McporterServerSettings> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const entries = Object.entries(value).flatMap(([serverName, rawSettings]) => {
    if (!isPlainObject(rawSettings)) {
      return [];
    }

    const args = normalizeStringArray(rawSettings.args);
    const command = normalizeCommand(rawSettings.command);
    const cwd = normalizeNonEmptyString(rawSettings.cwd);
    const env = normalizeStringRecord(rawSettings.env);
    const headers = normalizeStringRecord(rawSettings.headers);
    const url = normalizeNonEmptyString(rawSettings.url);
    const mode =
      typeof rawSettings.mode === "string"
        ? parseMcporterMode(rawSettings.mode)
        : undefined;
    if (!env && !mode && !command && !url) {
      return [];
    }

    return [
      [
        serverName,
        {
          ...(args ? { args } : {}),
          ...(command ? { command } : {}),
          ...(cwd ? { cwd } : {}),
          ...(env ? { env } : {}),
          ...(headers ? { headers } : {}),
          ...(mode ? { mode } : {}),
          ...(url ? { url } : {}),
        },
      ] as const,
    ];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeCommand(value: unknown): string | string[] | undefined {
  if (Array.isArray(value)) {
    return normalizeStringArray(value);
  }
  return normalizeNonEmptyString(value);
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (!value.every((entry) => typeof entry === "string")) {
    return undefined;
  }
  return value.length > 0 ? value : undefined;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const entries = Object.entries(value).flatMap(([key, rawValue]) => {
    if (typeof rawValue !== "string") {
      return [];
    }
    return [[key, rawValue] as const];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeTimeoutMs(value: unknown): number {
  if (typeof value === "number") {
    return resolveCallTimeoutFromInputs(value, undefined);
  }
  if (typeof value === "string") {
    return resolveCallTimeoutFromInputs(undefined, value);
  }
  return DEFAULT_CALL_TIMEOUT_MS;
}

function isMissingFileError(
  error: unknown,
): error is NodeJS.ErrnoException & { code: "ENOENT" } {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT",
  );
}
