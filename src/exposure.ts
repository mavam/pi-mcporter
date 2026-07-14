export const MCPORTER_EXPOSURES = [
  "on-demand",
  "index",
  "match",
  "native",
] as const;

export type McporterExposure = (typeof MCPORTER_EXPOSURES)[number];
export type DefaultMcporterExposure = Exclude<McporterExposure, "native">;

export interface ServerExposurePolicy {
  exposure: McporterExposure;
  includeTools?: string[];
  excludeTools?: string[];
}

export function isMcporterExposure(value: unknown): value is McporterExposure {
  return (
    typeof value === "string" &&
    MCPORTER_EXPOSURES.includes(value as McporterExposure)
  );
}

export function resolveServerExposure(
  defaultExposure: DefaultMcporterExposure,
  policy?: ServerExposurePolicy,
): McporterExposure {
  return policy?.exposure ?? defaultExposure;
}

export function isToolExposed(
  toolName: string,
  policy: ServerExposurePolicy,
): boolean {
  const included =
    !policy.includeTools ||
    policy.includeTools.some((pattern) =>
      matchesToolPattern(toolName, pattern),
    );
  if (!included) {
    return false;
  }

  return !policy.excludeTools?.some((pattern) =>
    matchesToolPattern(toolName, pattern),
  );
}

export function matchesToolPattern(toolName: string, pattern: string): boolean {
  const source = [...pattern]
    .map((character) => {
      if (character === "*") return ".*";
      if (character === "?") return ".";
      return escapeRegExp(character);
    })
    .join("");
  return new RegExp(`^${source}$`, "u").test(toolName);
}

function escapeRegExp(character: string): string {
  return /[\\^$.*+?()[\]{}|]/u.test(character) ? `\\${character}` : character;
}
