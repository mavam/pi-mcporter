export const MCPORTER_MODES = ["lazy", "preload"] as const;

export type McporterMode = (typeof MCPORTER_MODES)[number];

export function parseMcporterMode(
  value: string | undefined,
): McporterMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "lazy" ||
    normalized === "preload"
  ) {
    return normalized;
  }

  return undefined;
}

export function resolveMcporterMode(value: string | undefined): McporterMode {
  return parseMcporterMode(value) ?? "lazy";
}

export function shouldPreloadCatalog(mode: McporterMode): boolean {
  return mode === "preload";
}
