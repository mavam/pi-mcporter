import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DEFAULT_MAX_MATCHED_TOOLS,
  MAX_CALL_TIMEOUT_MS,
  MAX_DISCOVERY_TIMEOUT_MS,
  MAX_MATCHED_TOOLS,
  MIN_DISCOVERY_TIMEOUT_MS,
} from "./constants.js";
import {
  isMcporterExposure,
  type DefaultMcporterExposure,
  type ServerExposurePolicy,
} from "./exposure.js";
import { isPlainObject, normalizeRootDir, toErrorMessage } from "./helpers.js";

export const MCPORTER_SETTINGS_VERSION = 1 as const;

export interface McporterSettings {
  version: typeof MCPORTER_SETTINGS_VERSION;
  defaultExposure: DefaultMcporterExposure;
  callTimeoutMs: number;
  discoveryTimeoutMs: number;
  maxMatchedTools: number;
  servers: Record<string, ServerExposurePolicy>;
}

export interface ResolvedMcporterConfig extends McporterSettings {
  fingerprint: string;
  globalPath: string;
  projectPath: string;
  projectTrusted: boolean;
  loadedPaths: string[];
}

interface McporterSettingsLayer {
  version: typeof MCPORTER_SETTINGS_VERSION;
  defaultExposure?: DefaultMcporterExposure;
  callTimeoutMs?: number;
  discoveryTimeoutMs?: number;
  maxMatchedTools?: number;
  servers?: Record<string, ServerExposurePolicy | null>;
}

export interface SettingsLoaderOptions {
  agentDirectory?: string;
  projectTrusted?: boolean;
  readFileFn?: (path: string, encoding: "utf8") => Promise<string>;
  rootDir?: string;
}

const TOP_LEVEL_KEYS = new Set([
  "version",
  "defaultExposure",
  "callTimeoutMs",
  "discoveryTimeoutMs",
  "maxMatchedTools",
  "servers",
]);
const SERVER_POLICY_KEYS = new Set([
  "exposure",
  "includeTools",
  "excludeTools",
]);

export function getDefaultMcporterSettings(): McporterSettings {
  return {
    version: MCPORTER_SETTINGS_VERSION,
    defaultExposure: "index",
    callTimeoutMs: DEFAULT_CALL_TIMEOUT_MS,
    discoveryTimeoutMs: DEFAULT_DISCOVERY_TIMEOUT_MS,
    maxMatchedTools: DEFAULT_MAX_MATCHED_TOOLS,
    servers: {},
  };
}

export function resolveMcporterSettingsPaths(
  rootDir: string,
  agentDirectory = getAgentDir(),
): { globalPath: string; projectPath: string } {
  return {
    globalPath: join(agentDirectory, "mcporter.json"),
    projectPath: join(rootDir, ".pi", "mcporter.json"),
  };
}

export function normalizeMcporterSettings(
  value: unknown,
  source = "mcporter.json",
): McporterSettings {
  const layer = normalizeSettingsLayer(value, source);
  return mergeSettingsLayers(layer, undefined);
}

export async function loadResolvedMcporterConfig(
  options: SettingsLoaderOptions = {},
): Promise<ResolvedMcporterConfig> {
  const rootDir = normalizeRootDir(options.rootDir);
  const readFileFn = options.readFileFn ?? readFile;
  const { globalPath, projectPath } = resolveMcporterSettingsPaths(
    rootDir,
    options.agentDirectory,
  );

  const projectTrusted = options.projectTrusted === true;
  const globalSource = await readOptionalSettingsFile(globalPath, readFileFn);
  const projectSource = projectTrusted
    ? await readOptionalSettingsFile(projectPath, readFileFn)
    : undefined;
  const hasGlobalSource = globalSource !== undefined;
  const hasProjectSource = projectSource !== undefined;
  const globalLayer = hasGlobalSource
    ? normalizeSettingsLayer(globalSource, globalPath)
    : undefined;
  const projectLayer = hasProjectSource
    ? normalizeSettingsLayer(projectSource, projectPath)
    : undefined;
  const settings = mergeSettingsLayers(globalLayer, projectLayer);
  const loadedPaths = [
    ...(hasGlobalSource ? [globalPath] : []),
    ...(hasProjectSource ? [projectPath] : []),
  ];

  return {
    ...settings,
    fingerprint: fingerprintSettings(settings),
    globalPath,
    projectPath,
    projectTrusted,
    loadedPaths,
  };
}

function normalizeSettingsLayer(
  value: unknown,
  source: string,
): McporterSettingsLayer {
  if (!isPlainObject(value)) {
    throw new Error(`${source}: expected a top-level JSON object.`);
  }

  rejectUnknownKeys(value, TOP_LEVEL_KEYS, source);
  if (value.version !== MCPORTER_SETTINGS_VERSION) {
    throw new Error(
      `${source}: version must be ${MCPORTER_SETTINGS_VERSION}; received ${formatValue(value.version)}.`,
    );
  }

  const defaultExposure = normalizeDefaultExposure(
    value.defaultExposure,
    source,
  );
  const callTimeoutMs = normalizeOptionalInteger(
    value.callTimeoutMs,
    `${source}: callTimeoutMs`,
    1,
    MAX_CALL_TIMEOUT_MS,
  );
  const discoveryTimeoutMs = normalizeOptionalInteger(
    value.discoveryTimeoutMs,
    `${source}: discoveryTimeoutMs`,
    MIN_DISCOVERY_TIMEOUT_MS,
    MAX_DISCOVERY_TIMEOUT_MS,
  );
  const maxMatchedTools = normalizeOptionalInteger(
    value.maxMatchedTools,
    `${source}: maxMatchedTools`,
    1,
    MAX_MATCHED_TOOLS,
  );
  const servers = normalizeServers(value.servers, source);

  return {
    version: MCPORTER_SETTINGS_VERSION,
    ...(defaultExposure ? { defaultExposure } : {}),
    ...(callTimeoutMs !== undefined ? { callTimeoutMs } : {}),
    ...(discoveryTimeoutMs !== undefined ? { discoveryTimeoutMs } : {}),
    ...(maxMatchedTools !== undefined ? { maxMatchedTools } : {}),
    ...(servers ? { servers } : {}),
  };
}

function mergeSettingsLayers(
  globalLayer: McporterSettingsLayer | undefined,
  projectLayer: McporterSettingsLayer | undefined,
): McporterSettings {
  const defaults = getDefaultMcporterSettings();
  const servers: Record<string, ServerExposurePolicy> = {};

  applyServerLayer(servers, globalLayer?.servers);
  applyServerLayer(servers, projectLayer?.servers);

  return {
    version: MCPORTER_SETTINGS_VERSION,
    defaultExposure:
      projectLayer?.defaultExposure ??
      globalLayer?.defaultExposure ??
      defaults.defaultExposure,
    callTimeoutMs:
      projectLayer?.callTimeoutMs ??
      globalLayer?.callTimeoutMs ??
      defaults.callTimeoutMs,
    discoveryTimeoutMs:
      projectLayer?.discoveryTimeoutMs ??
      globalLayer?.discoveryTimeoutMs ??
      defaults.discoveryTimeoutMs,
    maxMatchedTools:
      projectLayer?.maxMatchedTools ??
      globalLayer?.maxMatchedTools ??
      defaults.maxMatchedTools,
    servers,
  };
}

function applyServerLayer(
  target: Record<string, ServerExposurePolicy>,
  layer: Record<string, ServerExposurePolicy | null> | undefined,
): void {
  if (!layer) return;
  for (const [server, policy] of Object.entries(layer)) {
    if (policy === null) {
      delete target[server];
    } else {
      defineOwnServerPolicy(target, server, policy);
    }
  }
}

function normalizeDefaultExposure(
  value: unknown,
  source: string,
): DefaultMcporterExposure | undefined {
  if (value === undefined) return undefined;
  if (!isMcporterExposure(value) || value === "native") {
    throw new Error(
      `${source}: defaultExposure must be 'on-demand', 'index', or 'match'.`,
    );
  }
  return value;
}

function normalizeServers(
  value: unknown,
  source: string,
): Record<string, ServerExposurePolicy | null> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new Error(`${source}: servers must be a JSON object.`);
  }

  const servers: Record<string, ServerExposurePolicy | null> = {};
  for (const [rawServer, rawPolicy] of Object.entries(value)) {
    const server = rawServer.trim();
    if (server.length === 0) {
      throw new Error(`${source}: server names must not be empty.`);
    }
    if (rawPolicy === null) {
      defineOwnServerPolicy(servers, server, null);
      continue;
    }
    defineOwnServerPolicy(
      servers,
      server,
      normalizeServerPolicy(rawPolicy, `${source}: servers.${server}`),
    );
  }
  return servers;
}

function defineOwnServerPolicy<T>(
  target: Record<string, T>,
  server: string,
  policy: T,
): void {
  Object.defineProperty(target, server, {
    configurable: true,
    enumerable: true,
    value: policy,
    writable: true,
  });
}

function normalizeServerPolicy(
  value: unknown,
  path: string,
): ServerExposurePolicy {
  if (!isPlainObject(value)) {
    throw new Error(`${path} must be a JSON object or null.`);
  }
  rejectUnknownKeys(value, SERVER_POLICY_KEYS, path);
  if (!isMcporterExposure(value.exposure)) {
    throw new Error(
      `${path}.exposure must be 'on-demand', 'index', 'match', or 'native'.`,
    );
  }

  const includeTools = normalizePatterns(
    value.includeTools,
    `${path}.includeTools`,
  );
  const excludeTools = normalizePatterns(
    value.excludeTools,
    `${path}.excludeTools`,
  );
  if (
    (value.exposure === "on-demand" || value.exposure === "index") &&
    (includeTools || excludeTools)
  ) {
    throw new Error(
      `${path}: tool filters are only valid for 'match' or 'native' exposure.`,
    );
  }
  if (value.exposure === "native" && !includeTools) {
    throw new Error(
      `${path}: native exposure requires a non-empty includeTools array; use ['*'] to expose every tool.`,
    );
  }

  return {
    exposure: value.exposure,
    ...(includeTools ? { includeTools } : {}),
    ...(excludeTools ? { excludeTools } : {}),
  };
}

function normalizePatterns(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (entry) => typeof entry === "string" && entry.trim().length > 0,
    )
  ) {
    throw new Error(`${path} must be a non-empty array of non-empty strings.`);
  }
  return value.map((entry) => entry.trim());
}

function normalizeOptionalInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${path} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  knownKeys: Set<string>,
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !knownKeys.has(key));
  if (unknown.length > 0) {
    throw new Error(`${path}: unknown key(s): ${unknown.sort().join(", ")}.`);
  }
}

async function readOptionalSettingsFile(
  path: string,
  readFileFn: (path: string, encoding: "utf8") => Promise<string>,
): Promise<unknown | undefined> {
  try {
    const raw = await readFileFn(path, "utf8");
    try {
      return JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(`${path}: invalid JSON: ${toErrorMessage(error)}`);
    }
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    if (error instanceof Error && error.message.startsWith(`${path}:`)) {
      throw error;
    }
    throw new Error(
      `${path}: failed to read settings: ${toErrorMessage(error)}`,
    );
  }
}

function fingerprintSettings(settings: McporterSettings): string {
  return createHash("sha256").update(JSON.stringify(settings)).digest("hex");
}

function formatValue(value: unknown): string {
  return value === undefined ? "missing" : JSON.stringify(value);
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
