export const MCPORTER_MODES = ["lazy", "eager", "hoist"] as const;

export type McporterMode = (typeof MCPORTER_MODES)[number];

export function resolveMcporterMode(value: string | undefined): McporterMode {
  if (typeof value !== "string") {
    return "lazy";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "eager" || normalized === "hoist") {
    return normalized;
  }

  return "lazy";
}

export function shouldPreloadCatalog(
  mode: McporterMode,
  serverModes: Readonly<Record<string, McporterMode>> = {},
): boolean {
  if (mode !== "lazy") {
    return true;
  }
  return Object.values(serverModes).some((serverMode) => serverMode !== "lazy");
}

export function shouldHoistTools(mode: McporterMode): boolean {
  return mode === "hoist";
}

export function resolveServerMode(
  defaultMode: McporterMode,
  serverModes: Readonly<Record<string, McporterMode>>,
  server: string,
): McporterMode {
  return serverModes[server] ?? defaultMode;
}
