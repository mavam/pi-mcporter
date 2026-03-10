import {
  keyHint,
  type Theme,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import {
  Text,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@mariozechner/pi-tui";
import { Type, type TSchema } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Runtime } from "mcporter";
import { handleCallAction } from "./actions/call.js";
import type { CatalogStore } from "./catalog-store.js";
import { formatArgsObjectKeyValuePreview } from "./call-args-preview.js";
import { isPlainObject } from "./helpers.js";
import { withPromptMetadata } from "./tool-registration.js";
import type { CatalogTool, ToolDetails } from "./types.js";

export function registerHoistedTools(
  pi: ExtensionAPI,
  ensureRuntime: () => Promise<Runtime>,
  catalogStore: CatalogStore,
  tools: CatalogTool[],
  resolveCallTimeout: (override?: number) => number,
  registeredSelectors: Map<string, string>,
  registeredNames: Set<string>,
): string[] {
  const activeToolNames: string[] = [];
  const occupiedNames = new Set([
    ...pi.getAllTools().map((tool) => tool.name),
    ...registeredNames,
  ]);

  for (const tool of tools) {
    const name =
      registeredSelectors.get(tool.selector) ??
      createUniqueHoistedToolName(tool, occupiedNames);
    occupiedNames.add(name);
    registeredNames.add(name);
    registeredSelectors.set(tool.selector, name);
    activeToolNames.push(name);

    pi.registerTool(
      createHoistedToolDefinition(
        name,
        tool,
        ensureRuntime,
        catalogStore,
        resolveCallTimeout,
      ),
    );
  }

  return activeToolNames;
}

function createHoistedToolDefinition(
  name: string,
  tool: CatalogTool,
  ensureRuntime: () => Promise<Runtime>,
  catalogStore: CatalogStore,
  resolveCallTimeout: (override?: number) => number,
): ToolDefinition<TSchema, ToolDetails> {
  return withPromptMetadata(
    {
      name,
      label: tool.selector,
      description: buildHoistedDescription(tool),
      parameters: normalizeHoistedParameters(tool),
      async execute(_toolCallId, rawParams, signal, _onUpdate, _ctx) {
        const activeRuntime = await ensureRuntime();
        const args = isPlainObject(rawParams) ? rawParams : {};
        return await handleCallAction(
          activeRuntime,
          {
            action: "call",
            selector: tool.selector,
            args,
          },
          signal,
          catalogStore,
          resolveCallTimeout,
        );
      },
      renderCall(args, theme) {
        return renderHoistedCallHeader(
          tool.selector,
          isPlainObject(args) ? args : {},
          theme,
        );
      },
      renderResult(result, { expanded, isPartial }, theme) {
        const details = result.details as ToolDetails | undefined;
        const text = extractTextContent(result.content);
        const isError = Boolean((result as { isError?: boolean }).isError);

        if (isPartial) {
          return renderSimpleText(text ?? "Working…", theme, "warning");
        }

        if (isError) {
          return renderBlockText(
            text ?? `${tool.selector} failed`,
            theme,
            "error",
          );
        }

        if (expanded) {
          return renderBlockText(text ?? "", theme, "toolOutput");
        }

        const summary =
          details?.callOutputSummary ?? `${tool.selector}: output available`;
        let summaryText = theme.fg("success", summary);
        summaryText += theme.fg("muted", ` (${getExpandHint()})`);
        return new Text(summaryText, 0, 0);
      },
    },
    {
      promptSnippet: buildHoistedPromptSnippet(tool),
      promptGuidelines: [
        `Call '${tool.selector}' directly when it clearly matches the user's request.`,
      ],
    },
  );
}

function sanitizeToolNamePart(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function createUniqueHoistedToolName(
  tool: CatalogTool,
  usedNames: Set<string>,
): string {
  const server = sanitizeToolNamePart(tool.server) || "server";
  const method = sanitizeToolNamePart(tool.tool) || "tool";
  const base = `mcp__${server}__${method}`;

  let candidate = base;
  let index = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}__${index}`;
    index += 1;
  }
  return candidate;
}

function buildHoistedDescription(tool: CatalogTool): string {
  const description = tool.description?.trim();
  if (description) {
    return `${description} (MCP: ${tool.selector})`;
  }
  return `Call MCP tool '${tool.selector}'.`;
}

function buildHoistedPromptSnippet(tool: CatalogTool): string {
  const description = tool.description?.trim();
  return description ? `${tool.selector} — ${description}` : tool.selector;
}

function normalizeHoistedParameters(tool: CatalogTool): TSchema {
  if (isPlainObject(tool.inputSchema)) {
    const schema = { ...tool.inputSchema } as Record<string, unknown>;
    const hasProperties = isPlainObject(schema.properties);
    const isComposedObjectSchema =
      "$ref" in schema ||
      Array.isArray(schema.allOf) ||
      Array.isArray(schema.anyOf) ||
      Array.isArray(schema.oneOf);

    if (schema.type === undefined && hasProperties) {
      schema.type = "object";
    }
    if (schema.type === "object" && schema.additionalProperties === undefined) {
      schema.additionalProperties = true;
    }
    if (schema.type === "object" || isComposedObjectSchema) {
      return schema as TSchema;
    }
  }

  return Type.Object(
    {},
    {
      additionalProperties: true,
      description: `Arguments object for '${tool.selector}'.`,
    },
  );
}

function extractTextContent(
  content: Array<{ type: string; text?: string }> | undefined,
): string | undefined {
  if (!content || content.length === 0) {
    return undefined;
  }
  const text = content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text?.trimEnd() ?? "")
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

function renderBlockText(
  text: string,
  theme: Pick<Theme, "fg">,
  color: "toolOutput" | "error",
): Text {
  if (!text) {
    return new Text("", 0, 0);
  }
  const rendered = text
    .split("\n")
    .map((line) => theme.fg(color, line))
    .join("\n");
  return new Text(`\n${rendered}`, 0, 0);
}

function renderSimpleText(
  text: string,
  theme: Pick<Theme, "fg">,
  color: "warning" | "muted" | "success",
): Text {
  return new Text(theme.fg(color, text), 0, 0);
}

function getExpandHint(): string {
  try {
    return keyHint("expandTools", "to expand");
  } catch {
    return "to expand";
  }
}

function renderHoistedCallHeader(
  selector: string,
  args: Record<string, unknown>,
  theme: Theme,
): Component {
  return {
    invalidate() {},
    render(width) {
      const lines: string[] = [];
      const header = `${theme.fg("toolTitle", theme.bold(selector))}`;
      const headerLine = truncateToWidth(header, width);
      lines.push(
        headerLine + " ".repeat(Math.max(0, width - visibleWidth(headerLine))),
      );

      const previewWidth = Math.max(0, width - 2);
      const preview = formatArgsObjectKeyValuePreview(args, previewWidth);
      if (preview) {
        const previewLine = truncateToWidth(
          `  ${theme.fg("muted", preview)}`,
          width,
        );
        lines.push(
          previewLine +
            " ".repeat(Math.max(0, width - visibleWidth(previewLine))),
        );
      }

      return lines;
    },
  };
}
