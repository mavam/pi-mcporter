import type { Runtime } from "mcporter";
import type { CatalogService } from "./catalog-service.js";
import {
  isToolExposed,
  resolveServerExposure,
  type McporterExposure,
  type ServerExposurePolicy,
} from "./exposure.js";
import { rankTools } from "./search.js";
import type { ResolvedMcporterConfig } from "./settings.js";
import {
  buildMatchedToolsMessage,
  buildServerIndexAppend,
} from "./system-prompt.js";
import type { CatalogTool } from "./types.js";
import type { RuntimeSession } from "./runtime-session.js";

export interface PreparedPromptCatalog {
  indexServers: string[];
  matchMessage?: string;
  matchedTools: CatalogTool[];
  nativeTools: CatalogTool[];
  pendingServers: string[];
  staleServers: string[];
  systemPromptAppend?: string;
}

export class PromptCatalogProvider {
  constructor(
    private readonly runtimeSession: RuntimeSession,
    private readonly catalogService: CatalogService,
  ) {}

  async startBackgroundWarm(
    config: ResolvedMcporterConfig,
    rootDir?: string,
    proxyActive = true,
  ): Promise<void> {
    if (!configurationNeedsSchemaCatalog(config, proxyActive)) return;

    const runtime = await this.runtimeSession.getRuntime(rootDir);
    const servers = getSchemaServers(runtime, config, proxyActive);
    this.catalogService.startBackgroundSchemaSync(runtime, servers);
  }

  async prepare(input: {
    config: ResolvedMcporterConfig;
    prompt: string;
    proxyActive: boolean;
    rootDir?: string;
  }): Promise<PreparedPromptCatalog> {
    const { config, prompt, proxyActive, rootDir } = input;
    if (!configurationNeedsRuntime(config, proxyActive)) {
      return emptyPreparedCatalog();
    }

    const runtime = await this.runtimeSession.getRuntime(rootDir);
    const servers = runtime.listServers();
    const indexServers = proxyActive
      ? servers.filter(
          (server) => effectiveExposure(config, server) !== "on-demand",
        )
      : [];
    const schemaServers = getSchemaServers(runtime, config, proxyActive);
    const prepared = await this.catalogService.prepareSchemaCatalogs(
      runtime,
      schemaServers,
      config.discoveryTimeoutMs,
    );

    const matchCandidates: CatalogTool[] = [];
    const nativeTools: CatalogTool[] = [];
    for (const server of servers) {
      const tools = prepared.byServer.get(server) ?? [];
      const policy = serverPolicy(config, server);
      const exposure = effectiveExposure(config, server);

      if (proxyActive && exposure === "match") {
        matchCandidates.push(
          ...tools.filter((tool) => toolMatchesPolicy(tool, policy)),
        );
      }
      if (exposure === "native" && policy) {
        nativeTools.push(
          ...tools.filter((tool) => isToolExposed(tool.tool, policy)),
        );
      }
    }

    const matchedTools = rankPromptTools(matchCandidates, prompt).slice(
      0,
      config.maxMatchedTools,
    );

    return {
      indexServers,
      matchedTools,
      nativeTools: dedupeTools(nativeTools),
      pendingServers: prepared.pendingServers,
      staleServers: prepared.staleServers,
      systemPromptAppend: buildServerIndexAppend(indexServers),
      matchMessage: buildMatchedToolsMessage(matchedTools),
    };
  }
}

function configurationNeedsRuntime(
  config: ResolvedMcporterConfig,
  proxyActive: boolean,
): boolean {
  const hasNative = Object.values(config.servers).some(
    (policy) => policy.exposure === "native",
  );
  if (hasNative) return true;
  if (!proxyActive) return false;
  return (
    config.defaultExposure !== "on-demand" ||
    Object.values(config.servers).some(
      (policy) => policy.exposure !== "on-demand",
    )
  );
}

function configurationNeedsSchemaCatalog(
  config: ResolvedMcporterConfig,
  proxyActive: boolean,
): boolean {
  return (
    (proxyActive && config.defaultExposure === "match") ||
    Object.values(config.servers).some(
      (policy) =>
        (proxyActive && policy.exposure === "match") ||
        policy.exposure === "native",
    )
  );
}

function getSchemaServers(
  runtime: Runtime,
  config: ResolvedMcporterConfig,
  proxyActive: boolean,
): string[] {
  return runtime.listServers().filter((server) => {
    const exposure = effectiveExposure(config, server);
    return exposure === "native" || (proxyActive && exposure === "match");
  });
}

function effectiveExposure(
  config: ResolvedMcporterConfig,
  server: string,
): McporterExposure {
  return resolveServerExposure(
    config.defaultExposure,
    serverPolicy(config, server),
  );
}

function serverPolicy(
  config: ResolvedMcporterConfig,
  server: string,
): ServerExposurePolicy | undefined {
  return Object.hasOwn(config.servers, server)
    ? config.servers[server]
    : undefined;
}

function toolMatchesPolicy(
  tool: CatalogTool,
  policy: ServerExposurePolicy | undefined,
): boolean {
  return policy ? isToolExposed(tool.tool, policy) : true;
}

function dedupeTools(tools: CatalogTool[]): CatalogTool[] {
  const bySelector = new Map(tools.map((tool) => [tool.selector, tool]));
  return [...bySelector.values()].sort((a, b) =>
    a.selector.localeCompare(b.selector),
  );
}

const PROMPT_STOP_WORDS = new Set([
  "about",
  "could",
  "from",
  "have",
  "into",
  "just",
  "please",
  "that",
  "their",
  "then",
  "there",
  "these",
  "this",
  "those",
  "want",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

function rankPromptTools(tools: CatalogTool[], prompt: string): CatalogTool[] {
  if (!prompt.trim()) return [];

  const exact = rankTools(tools, prompt);
  const scores = new Map<string, number>();
  exact.forEach((tool, index) => {
    scores.set(tool.selector, Math.max(1, 10_000 - index));
  });

  const tokens = [
    ...new Set(
      prompt
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((token) => token.length >= 3 && !PROMPT_STOP_WORDS.has(token)),
    ),
  ];
  for (const token of tokens) {
    rankTools(tools, token).forEach((tool, index) => {
      scores.set(
        tool.selector,
        (scores.get(tool.selector) ?? 0) + Math.max(1, 100 - index),
      );
    });
  }

  const bySelector = new Map(tools.map((tool) => [tool.selector, tool]));
  return [...scores.entries()]
    .sort(
      ([leftSelector, leftScore], [rightSelector, rightScore]) =>
        rightScore - leftScore || leftSelector.localeCompare(rightSelector),
    )
    .flatMap(([selector]) => {
      const tool = bySelector.get(selector);
      return tool ? [tool] : [];
    });
}

function emptyPreparedCatalog(): PreparedPromptCatalog {
  return {
    indexServers: [],
    matchedTools: [],
    nativeTools: [],
    pendingServers: [],
    staleServers: [],
  };
}
