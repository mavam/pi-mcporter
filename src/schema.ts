import { formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import {
  SCHEMA_SNIPPET_MAX_BYTES,
  SCHEMA_SNIPPET_MAX_LINES,
} from "./constants.js";
import { isRecord, safeStringify } from "./helpers.js";
import { sanitizeMetadataText, sanitizePromptCode } from "./metadata.js";

export function summarizeInputSchema(
  schema: unknown,
  options: {
    maxDescriptionLength?: number;
    maxProperties?: number;
  } = {},
): string[] {
  const lines: string[] = [];
  if (!isRecord(schema)) {
    lines.push("Input: schema unavailable.");
    return lines;
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const propertyNames = Object.keys(properties);
  const required = new Set<string>(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  );

  if (propertyNames.length === 0) {
    lines.push("Input: no parameters.");
    return lines;
  }

  lines.push(
    `Input parameters (${required.size} required, ${propertyNames.length - required.size} optional):`,
  );

  const maxProperties = options.maxProperties ?? 20;
  const preview = propertyNames.slice(0, maxProperties);
  for (const name of preview) {
    const propertySchema = properties[name];
    const type = schemaTypeSummary(propertySchema);
    const desc = propertyDescription(
      propertySchema,
      options.maxDescriptionLength,
    );
    let line = `- \`${sanitizePromptCode(name, 100)}\`${required.has(name) ? " (required)" : ""}: \`${sanitizePromptCode(type, 160)}\``;
    if (desc) {
      line += ` — ${desc}`;
    }
    lines.push(line);
  }

  if (propertyNames.length > preview.length) {
    lines.push(
      `- … ${propertyNames.length - preview.length} more parameter(s)`,
    );
  }

  return lines;
}

export function summarizeOutputSchema(schema: unknown): string[] {
  if (!isRecord(schema)) {
    return ["Output: schema unavailable."];
  }

  const type = schemaTypeSummary(schema);
  const description = propertyDescription(schema);
  if (description) {
    return [`Output: \`${sanitizePromptCode(type, 160)}\` — ${description}`];
  }
  return [`Output: \`${sanitizePromptCode(type, 160)}\``];
}

export function renderSchemaSnippet(schema: unknown): string {
  const serialized = safeStringify(schema, 2);
  const snippet = truncateHead(serialized, {
    maxBytes: SCHEMA_SNIPPET_MAX_BYTES,
    maxLines: SCHEMA_SNIPPET_MAX_LINES,
  });

  if (!snippet.truncated) {
    return snippet.content;
  }

  return [
    snippet.content,
    `[schema snippet truncated: ${snippet.outputLines}/${snippet.totalLines} lines, ` +
      `${formatSize(snippet.outputBytes)}/${formatSize(snippet.totalBytes)}]`,
  ].join("\n");
}

function schemaTypeSummary(schema: unknown, depth = 0): string {
  if (depth > 8) return "complex";
  if (!isRecord(schema)) {
    return "unknown";
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const preview = schema.enum
      .slice(0, 4)
      .map((entry) => JSON.stringify(entry));
    return schema.enum.length > 4
      ? `${preview.join(" | ")} | …`
      : preview.join(" | ");
  }

  const primitive = schema.type;
  if (typeof primitive === "string") {
    if (primitive === "array") {
      const itemType = schemaTypeSummary(schema.items, depth + 1);
      return `${itemType}[]`;
    }

    if (primitive === "object") {
      if (isRecord(schema.properties)) {
        const keys = Object.keys(schema.properties);
        if (keys.length === 0) {
          return "object";
        }
        const preview = keys.slice(0, 3).join(", ");
        return keys.length > 3 ? `object{${preview}, …}` : `object{${preview}}`;
      }
      return "object";
    }

    return primitive;
  }

  if (Array.isArray(primitive) && primitive.length > 0) {
    return primitive.join(" | ");
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const variants = schema.anyOf
      .slice(0, 4)
      .map((item) => schemaTypeSummary(item, depth + 1));
    return schema.anyOf.length > 4
      ? `${variants.join(" | ")} | …`
      : variants.join(" | ");
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const variants = schema.oneOf
      .slice(0, 4)
      .map((item) => schemaTypeSummary(item, depth + 1));
    return schema.oneOf.length > 4
      ? `${variants.join(" | ")} | …`
      : variants.join(" | ");
  }

  return "unknown";
}

function propertyDescription(schema: unknown, maxLength = 240): string {
  if (!isRecord(schema) || typeof schema.description !== "string") {
    return "";
  }

  return sanitizeMetadataText(schema.description, maxLength);
}
