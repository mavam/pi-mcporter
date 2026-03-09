export const MCPORTER_MODES = ["lazy", "eager", "hoist"] as const;

export type McporterMode = (typeof MCPORTER_MODES)[number];

export function resolveMcporterMode(
  flagValue: boolean | string | undefined,
): McporterMode {
  if (typeof flagValue !== "string") {
    return "lazy";
  }

  const normalized = flagValue.trim().toLowerCase();
  if (normalized === "eager" || normalized === "hoist") {
    return normalized;
  }

  return "lazy";
}

export function shouldPreloadCatalog(mode: McporterMode): boolean {
  return mode !== "lazy";
}

export function shouldHoistTools(mode: McporterMode): boolean {
  return mode === "hoist";
}
