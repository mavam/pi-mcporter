import { homedir } from "node:os";
import { join } from "node:path";
import type { ServerDefinition } from "mcporter";
import { resolveConfigValue } from "./secret-env.js";
import type { McporterServerSettings } from "./settings.js";

type RuntimeWithDefinitions = {
  registerDefinition(
    definition: ServerDefinition,
    options?: { overwrite?: boolean },
  ): void;
};

export function hasInlineDefinition(settings: McporterServerSettings): boolean {
  return settings.url !== undefined || settings.command !== undefined;
}

export function registerInlineServers(
  runtime: RuntimeWithDefinitions,
  mcpServers: Record<string, McporterServerSettings> | undefined,
  baseDir: string,
): void {
  if (!mcpServers) {
    return;
  }

  for (const [serverName, settings] of Object.entries(mcpServers)) {
    if (!hasInlineDefinition(settings)) {
      continue;
    }

    runtime.registerDefinition(
      buildInlineServerDefinition(serverName, settings, baseDir),
      { overwrite: true },
    );
  }
}

export function buildInlineServerDefinition(
  name: string,
  settings: McporterServerSettings,
  baseDir: string,
): ServerDefinition {
  // env is intentionally left off: attachSecretEnvToRuntime overlays the
  // resolved env afterwards and the definition's own env would win the merge.
  return {
    name,
    command: settings.url
      ? buildHttpCommand(name, settings)
      : buildStdioCommand(name, settings, baseDir),
  };
}

function buildHttpCommand(
  name: string,
  settings: McporterServerSettings,
): ServerDefinition["command"] {
  const rawUrl = settings.url ?? "";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      `Invalid URL '${rawUrl}' for mcporter mcpServers.${name}.url.`,
    );
  }

  const headers = settings.headers
    ? Object.fromEntries(
        Object.entries(settings.headers).map(([key, value]) => [
          key,
          resolveConfigValue(
            value,
            `mcporter mcpServers.${name}.headers.${key}`,
          ),
        ]),
      )
    : undefined;

  return {
    kind: "http",
    url,
    headers: ensureHttpAcceptHeader(headers),
  };
}

function buildStdioCommand(
  name: string,
  settings: McporterServerSettings,
  baseDir: string,
): ServerDefinition["command"] {
  const stdio = resolveStdioTokens(settings);
  if (!stdio) {
    throw new Error(`Empty command for mcporter mcpServers.${name}.command.`);
  }

  return {
    kind: "stdio",
    command: stdio.command,
    args: stdio.args,
    cwd: settings.cwd ? expandHome(settings.cwd) : baseDir,
  };
}

function resolveStdioTokens(
  settings: McporterServerSettings,
): { command: string; args: string[] } | undefined {
  const commandValue = settings.command;
  if (Array.isArray(commandValue)) {
    const [command, ...args] = commandValue;
    return command ? { command, args } : undefined;
  }
  if (typeof commandValue !== "string" || commandValue.length === 0) {
    return undefined;
  }

  if (settings.args && settings.args.length > 0) {
    return { command: commandValue, args: settings.args };
  }

  const [command, ...args] = parseCommandString(commandValue);
  return command ? { command, args } : undefined;
}

// Mirrors mcporter's config normalization: shell-like tokenization with
// single/double quotes and backslash escapes.
function parseCommandString(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;
  for (const char of value.trim()) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char === " " && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        result.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escapeNext) {
    current += "\\";
  }
  if (current.length > 0) {
    result.push(current);
  }
  return result;
}

// Mirrors mcporter's config normalization: streamable HTTP servers require
// both content types in the accept header.
function ensureHttpAcceptHeader(
  headers?: Record<string, string>,
): Record<string, string> | undefined {
  const requiredAccept = "application/json, text/event-stream";
  const normalized = headers ? { ...headers } : {};
  const acceptKey = Object.keys(normalized).find(
    (key) => key.toLowerCase() === "accept",
  );
  const currentValue = acceptKey ? normalized[acceptKey] : undefined;
  const lower = currentValue?.toLowerCase();
  if (
    !lower ||
    !lower.includes("application/json") ||
    !lower.includes("text/event-stream")
  ) {
    normalized[acceptKey ?? "accept"] = requiredAccept;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}
