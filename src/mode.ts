export const MCPORTER_MODES = ["lazy", "index", "preload"] as const;

export type McporterMode = (typeof MCPORTER_MODES)[number];

export function parseMcporterMode(
  value: string | undefined,
): McporterMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return MCPORTER_MODES.find((mode) => mode === normalized);
}

export function resolveMcporterMode(value: string | undefined): McporterMode {
  return parseMcporterMode(value) ?? "index";
}

export function resolveServerMode(
  globalMode: McporterMode,
  serverMode?: McporterMode,
): McporterMode {
  return serverMode ?? globalMode;
}

export function shouldPreloadCatalog(mode: McporterMode): boolean {
  return mode === "preload";
}
