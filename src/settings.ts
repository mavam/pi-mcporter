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

export type McporterSettings = {
  mode: McporterMode;
  serverModes?: Record<string, McporterMode>;
  timeoutMs: number;
};

export type ResolvedMcporterConfig = McporterSettings & {
  settingsPath: string;
};

type SettingsLoaderOptions = {
  homeDirectory?: string;
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
  const mode =
    typeof value.mode === "string"
      ? resolveMcporterMode(value.mode)
      : defaults.mode;
  const serverModes = normalizeServerModes(value.serverModes, value.mcpServers);
  const timeoutMs = normalizeTimeoutMs(value.timeoutMs);

  return {
    mode,
    ...(serverModes ? { serverModes } : {}),
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
  const settings = await loadMcporterSettings(options);
  return {
    ...settings,
    settingsPath: resolveMcporterSettingsPath(options.homeDirectory),
  };
}

function normalizeServerModes(
  value: unknown,
  legacyMcpServers: unknown,
): Record<string, McporterMode> | undefined {
  const modes = new Map<string, McporterMode>();

  for (const [serverName, mode] of Object.entries(
    normalizeServerModesFromValue(legacyMcpServers),
  )) {
    modes.set(serverName, mode);
  }

  for (const [serverName, mode] of Object.entries(
    normalizeServerModesFromValue(value),
  )) {
    modes.set(serverName, mode);
  }

  return modes.size > 0 ? Object.fromEntries(modes) : undefined;
}

function normalizeServerModesFromValue(
  value: unknown,
): Record<string, McporterMode> {
  if (!isPlainObject(value)) {
    return {};
  }

  const entries = Object.entries(value).flatMap(([serverName, rawSettings]) => {
    const mode = parseServerModeSetting(rawSettings);
    return mode ? ([[serverName, mode]] as const) : [];
  });

  return Object.fromEntries(entries);
}

function parseServerModeSetting(value: unknown): McporterMode | undefined {
  if (typeof value === "string") {
    return parseMcporterMode(value);
  }

  if (isPlainObject(value) && typeof value.mode === "string") {
    return parseMcporterMode(value.mode);
  }

  return undefined;
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
