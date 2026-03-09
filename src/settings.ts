import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CALL_TIMEOUT_MS } from "./constants.js";
import { isPlainObject, toErrorMessage } from "./helpers.js";
import { resolveCallTimeoutFromInputs } from "./inputs.js";
import { resolveMcporterMode, type McporterMode } from "./mode.js";

export type McporterSettings = {
  configPath?: string;
  mode: McporterMode;
  serverModes: Record<string, McporterMode>;
  timeoutMs: number;
};

type SettingsLoaderOptions = {
  homeDirectory?: string;
  readFileFn?: (path: string, encoding: "utf8") => Promise<string>;
};

export function getDefaultMcporterSettings(): McporterSettings {
  return {
    mode: "lazy",
    serverModes: {},
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
  const timeoutMs = normalizeTimeoutMs(value.timeoutMs);
  const mode =
    typeof value.mode === "string"
      ? resolveMcporterMode(value.mode)
      : defaults.mode;
  const serverModes = normalizeServerModes(value.serverModes);

  return {
    configPath,
    mode,
    serverModes,
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

function normalizeConfigPath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

function normalizeServerModes(value: unknown): Record<string, McporterMode> {
  if (!isPlainObject(value)) {
    return {};
  }

  const entries = Object.entries(value)
    .map(([server, modeValue]) => {
      const name = server.trim();
      if (!name || typeof modeValue !== "string") {
        return undefined;
      }
      return [name, resolveMcporterMode(modeValue)] as const;
    })
    .filter(
      (entry): entry is readonly [string, McporterMode] => entry !== undefined,
    );

  return Object.fromEntries(entries);
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
