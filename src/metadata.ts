import { isPlainObject } from "./helpers.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu;
const DIRECTIONAL_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/gu;
const SCHEMA_METADATA_KEYS = new Set([
  "$comment",
  "description",
  "examples",
  "title",
]);
const SCHEMA_MAP_KEYS = new Set([
  "$defs",
  "definitions",
  "dependencies",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);
const SCHEMA_VALUE_KEYS = new Set([
  "additionalItems",
  "additionalProperties",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "prefixItems",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]);

type SchemaValueContext = "metadata" | "schema" | "schema-map" | "value";

export function sanitizeMetadataText(text: string, maxLength: number): string {
  const cleaned = text
    .replace(CONTROL_CHARACTERS, " ")
    .replace(DIRECTIONAL_CONTROLS, "")
    .replace(/\s+/gu, " ")
    // Metadata must not be able to reproduce the exact untrusted-content
    // fence markers and escape them early.
    .replace(/(untrusted)\s+(mcp)/giu, "$1-$2")
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
    context: SchemaValueContext,
    depth = 0,
  ): unknown => {
    if (depth > 64) throw new Error("schema nesting exceeds 64 levels");
    if (typeof value === "string") {
      return context === "metadata" ? sanitizeMetadataText(value, 500) : value;
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
      const childContext =
        context === "metadata"
          ? "metadata"
          : context === "schema"
            ? "schema"
            : "value";
      const result = value.map((entry) =>
        visit(entry, childContext, depth + 1),
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
      const childContext = contextForChild(context, childKey);
      Object.defineProperty(result, childKey, {
        configurable: true,
        enumerable: true,
        value: visit(childValue, childContext, depth + 1),
        writable: true,
      });
    }
    seen.delete(value);
    return result;
  };

  return visit(schema, "schema");
}

function contextForChild(
  context: SchemaValueContext,
  key: string,
): SchemaValueContext {
  if (context === "metadata") return "metadata";
  if (context === "schema-map") return "schema";
  if (context !== "schema") return "value";
  if (SCHEMA_METADATA_KEYS.has(key)) return "metadata";
  if (SCHEMA_MAP_KEYS.has(key)) return "schema-map";
  if (
    SCHEMA_VALUE_KEYS.has(key) ||
    key === "allOf" ||
    key === "anyOf" ||
    key === "oneOf"
  ) {
    return "schema";
  }
  return "value";
}
