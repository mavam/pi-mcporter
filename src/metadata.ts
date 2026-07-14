import { isPlainObject } from "./helpers.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu;
const DIRECTIONAL_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/gu;
const SCHEMA_METADATA_KEYS = new Set([
  "$comment",
  "description",
  "examples",
  "title",
]);

export function sanitizeMetadataText(text: string, maxLength: number): string {
  const cleaned = text
    .replace(CONTROL_CHARACTERS, " ")
    .replace(DIRECTIONAL_CONTROLS, "")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length <= maxLength
    ? cleaned
    : `${cleaned.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function sanitizePromptCode(text: string, maxLength: number): string {
  return sanitizeMetadataText(text, maxLength).replaceAll("`", "\\`");
}

/**
 * Clones an MCP JSON Schema while cleaning only annotation fields. Validation
 * keywords, property names, enum values, and defaults retain their exact
 * semantics.
 */
export function sanitizeToolSchema(schema: unknown): unknown {
  const seen = new WeakSet<object>();

  const visit = (
    value: unknown,
    key?: string,
    insideMetadata = false,
    depth = 0,
  ): unknown => {
    if (depth > 64) throw new Error("schema nesting exceeds 64 levels");
    const isMetadata =
      insideMetadata || Boolean(key && SCHEMA_METADATA_KEYS.has(key));
    if (typeof value === "string") {
      return isMetadata ? sanitizeMetadataText(value, 500) : value;
    }
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) throw new Error("schema contains a cycle");
      seen.add(value);
      const result = value.map((entry) =>
        visit(entry, undefined, isMetadata, depth + 1),
      );
      seen.delete(value);
      return result;
    }
    if (!isPlainObject(value)) {
      throw new Error("schema must contain only JSON values");
    }
    if (seen.has(value)) throw new Error("schema contains a cycle");
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      Object.defineProperty(result, childKey, {
        configurable: true,
        enumerable: true,
        value: visit(childValue, childKey, isMetadata, depth + 1),
        writable: true,
      });
    }
    seen.delete(value);
    return result;
  };

  return visit(schema);
}
