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
  const serverModes = normalizeServerModes(value.serverModes);
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
): Record<string, McporterMode> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const entries = Object.entries(value).flatMap(([serverName, rawMode]) => {
    const mode =
      typeof rawMode === "string" ? parseMcporterMode(rawMode) : null;
    return mode ? ([[serverName, mode]] as const) : [];
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
