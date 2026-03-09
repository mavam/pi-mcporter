import { parseCallArgs } from "./inputs.js";
import type { McporterParams } from "./parameters.js";

function isBarePreviewToken(value: string): boolean {
  return /^[A-Za-z0-9._:/@-]+$/.test(value);
}

function truncateWithEllipsis(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}...`;
}

function stringifyPreviewJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "bigint") {
        return null;
      }
      if (typeof currentValue === "number" && !Number.isFinite(currentValue)) {
        return null;
      }
      if (
        currentValue === undefined ||
        typeof currentValue === "function" ||
        typeof currentValue === "symbol"
      ) {
        return null;
      }
      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }
        seen.add(currentValue);
      }
      return currentValue;
    });
    return json ?? "null";
  } catch {
    return "null";
  }
}

function formatPreviewString(value: string, maxChars: number): string {
  if (value.length > 0 && isBarePreviewToken(value)) {
    return truncateWithEllipsis(value, maxChars);
  }
  return formatJsonValuePreview(value, maxChars);
}

function formatPreviewKey(key: string, maxChars: number): string {
  if (key.length > 0 && isBarePreviewToken(key)) {
    return truncateWithEllipsis(key, maxChars);
  }
  return formatJsonValuePreview(key, maxChars);
}

function formatPreviewValue(value: unknown, maxChars: number): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
      return formatPreviewString(value, maxChars);
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      return "null";
    case "object":
      return formatJsonValuePreview(value, maxChars);
    default:
      return "null";
  }
}

function formatJsonValuePreview(value: unknown, maxChars: number): string {
  return truncateWithEllipsis(stringifyPreviewJson(value), maxChars);
}

export function formatArgsObjectKeyValuePreview(
  value: Record<string, unknown>,
  maxChars: number,
): string | undefined {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return undefined;
  }

  const preview = entries
    .map(
      ([key, entryValue]) =>
        `${formatPreviewKey(key, maxChars)}=${formatPreviewValue(entryValue, maxChars)}`,
    )
    .join(" ");

  return preview.length > 0
    ? truncateWithEllipsis(preview, maxChars)
    : undefined;
}

export function formatCallArgsPreview(
  params: McporterParams,
  maxChars: number,
): string | undefined {
  if (maxChars <= 0) {
    return undefined;
  }

  const argsResult = parseCallArgs(params);
  if ("error" in argsResult || Object.keys(argsResult.args).length === 0) {
    return undefined;
  }

  try {
    return formatArgsObjectKeyValuePreview(argsResult.args, maxChars);
  } catch {
    return undefined;
  }
}
