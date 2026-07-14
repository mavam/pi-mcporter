import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CatalogService } from "./catalog-service.js";
import { handleCallAction } from "./actions/call.js";
import {
  resolveServerExposure,
  type ServerExposurePolicy,
} from "./exposure.js";
import { textContent, toErrorMessage } from "./helpers.js";
import { resolveCallTimeoutFromInputs } from "./inputs.js";
import type { NativeToolStatus } from "./native-tools.js";
import { PromptCatalogProvider } from "./prompt-catalog-provider.js";
import {
  getDefaultMcporterSettings,
  loadResolvedMcporterConfig,
  resolveMcporterSettingsPaths,
  type ResolvedMcporterConfig,
  type SettingsLoaderOptions,
} from "./settings.js";
import {
  RuntimeSession,
  type RuntimeSessionOptions,
} from "./runtime-session.js";
import type { CatalogTool, ToolDetails } from "./types.js";

type LoadConfigFn = (
  options: SettingsLoaderOptions,
) => Promise<ResolvedMcporterConfig>;

type CreateMcporterControllerOptions = {
  agentDirectory?: string;
  catalogService?: CatalogService;
  createRuntimeFn?: RuntimeSessionOptions["createRuntimeFn"];
  loadConfigFn?: LoadConfigFn;
  packageVersion: string;
};

export interface PreparedMcporterTurn {
  configFingerprint?: string;
  matchMessage?: string;
  matchedSelectors: string[];
  nativeTools: CatalogTool[];
  systemPromptAppend?: string;
  warnings: string[];
}

interface ConfigLoadState {
  config?: ResolvedMcporterConfig;
  error?: string;
  rootDir: string;
}

interface LastExposureState {
  pendingServers: string[];
  staleServers: string[];
  warnings: string[];
}

export function createMcporterController(
  _pi: ExtensionAPI,
  options: CreateMcporterControllerOptions,
) {
  const catalogService = options.catalogService ?? new CatalogService();
  const loadConfigFn = options.loadConfigFn ?? loadResolvedMcporterConfig;
  const emittedWarnings = new Set<string>();
  const configFingerprints = new Map<string, string>();
  const lastExposureState = new Map<string, LastExposureState>();

  const runtimeSession = new RuntimeSession({
    createRuntimeFn: options.createRuntimeFn,
    onRuntimeInvalidated: () => catalogService.clear(),
    packageVersion: options.packageVersion,
  });
  const promptCatalogProvider = new PromptCatalogProvider(
    runtimeSession,
    catalogService,
  );

  async function loadConfig(rootDir?: string): Promise<ConfigLoadState> {
    const normalizedRoot = normalizeRoot(rootDir);
    try {
      const config = await loadConfigFn({
        rootDir: normalizedRoot,
        ...(options.agentDirectory
          ? { agentDirectory: options.agentDirectory }
          : {}),
      });
      const previousFingerprint = configFingerprints.get(normalizedRoot);
      if (
        previousFingerprint !== undefined &&
        previousFingerprint !== config.fingerprint
      ) {
        lastExposureState.delete(normalizedRoot);
      }
      configFingerprints.set(normalizedRoot, config.fingerprint);
      return { config, rootDir: normalizedRoot };
    } catch (error) {
      configFingerprints.delete(normalizedRoot);
      lastExposureState.delete(normalizedRoot);
      return {
        error: toErrorMessage(error),
        rootDir: normalizedRoot,
      };
    }
  }

  async function startSession(
    rootDir: string | undefined,
    proxyActive: boolean,
  ): Promise<string[]> {
    const loaded = await loadConfig(rootDir);
    if (!loaded.config) {
      return takeNewWarnings([invalidConfigWarning(loaded)]);
    }

    try {
      await promptCatalogProvider.startBackgroundWarm(
        loaded.config,
        loaded.rootDir,
        proxyActive,
      );
      return [];
    } catch (error) {
      return takeNewWarnings([
        `MCPorter background discovery failed: ${toErrorMessage(error)}`,
      ]);
    }
  }

  async function prepareTurn(input: {
    prompt: string;
    proxyActive: boolean;
    rootDir?: string;
  }): Promise<PreparedMcporterTurn> {
    const loaded = await loadConfig(input.rootDir);
    if (!loaded.config) {
      return {
        matchedSelectors: [],
        nativeTools: [],
        warnings: takeNewWarnings([invalidConfigWarning(loaded)]),
      };
    }

    try {
      const prepared = await promptCatalogProvider.prepare({
        config: loaded.config,
        prompt: input.prompt,
        proxyActive: input.proxyActive,
        rootDir: loaded.rootDir,
      });
      lastExposureState.set(loaded.rootDir, {
        pendingServers: prepared.pendingServers,
        staleServers: prepared.staleServers,
        warnings: prepared.warnings,
      });
      return {
        configFingerprint: loaded.config.fingerprint,
        matchedSelectors: prepared.matchedTools.map((tool) => tool.selector),
        nativeTools: prepared.nativeTools,
        ...(prepared.matchMessage
          ? { matchMessage: prepared.matchMessage }
          : {}),
        ...(prepared.systemPromptAppend
          ? { systemPromptAppend: prepared.systemPromptAppend }
          : {}),
        warnings: takeNewWarnings(
          prepared.warnings.map(
            (warning) => `MCPorter discovery failed for ${warning}`,
          ),
        ),
      };
    } catch (error) {
      const warning = `MCPorter exposure preparation failed: ${toErrorMessage(error)}`;
      lastExposureState.set(loaded.rootDir, {
        pendingServers: [],
        staleServers: [],
        warnings: [warning],
      });
      return {
        configFingerprint: loaded.config.fingerprint,
        matchedSelectors: [],
        nativeTools: [],
        warnings: takeNewWarnings([warning]),
      };
    }
  }

  async function resolveCallTimeout(
    override?: number,
    rootDir?: string,
  ): Promise<number> {
    const loaded = await loadConfig(rootDir);
    const configured =
      loaded.config?.callTimeoutMs ??
      getDefaultMcporterSettings().callTimeoutMs;
    return resolveCallTimeoutFromInputs(override, String(configured));
  }

  async function executeNative(
    selector: string,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<ToolDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<ToolDetails>> {
    if (signal?.aborted) throw new Error("Cancelled.");
    onUpdate?.({
      content: textContent("Calling MCP tool…"),
      details: { action: "call", selector },
    });
    const runtime = await runtimeSession.getRuntime(ctx.cwd);
    if (signal?.aborted) throw new Error("Cancelled.");
    return await handleCallAction(
      runtime,
      { action: "call", selector, args },
      signal,
      catalogService.store,
      (override) => resolveCallTimeout(override, ctx.cwd),
    );
  }

  async function formatStatus(
    rootDir: string | undefined,
    proxyActive: boolean,
    nativeStatus: NativeToolStatus,
  ): Promise<string> {
    const loaded = await loadConfig(rootDir);
    const lines = [
      "MCPorter status",
      `Root: ${loaded.rootDir}`,
      `Proxy: ${proxyActive ? "active" : "inactive"}`,
    ];

    if (!loaded.config) {
      const paths = resolveMcporterSettingsPaths(
        loaded.rootDir,
        options.agentDirectory,
      );
      lines.push(
        "Enrichment: disabled (invalid configuration)",
        `Global config: ${paths.globalPath}`,
        `Project config: ${paths.projectPath}`,
        `Error: ${loaded.error ?? "unknown configuration error"}`,
      );
      appendNativeStatus(lines, nativeStatus);
      return lines.join("\n");
    }

    const config = loaded.config;
    lines.push(
      `Config: ${config.loadedPaths.length > 0 ? config.loadedPaths.join(" + ") : "defaults"}`,
      `Fingerprint: ${config.fingerprint.slice(0, 12)}`,
      `Default exposure: ${config.defaultExposure}`,
      `Call timeout: ${config.callTimeoutMs}ms`,
      `Discovery budget: ${config.discoveryTimeoutMs}ms overall`,
      `Maximum matched tools: ${config.maxMatchedTools}`,
    );

    const runtime = runtimeSession.peekRuntime(loaded.rootDir);
    const runtimeServers = runtime?.listServers() ?? [];
    const servers = [
      ...new Set([...runtimeServers, ...Object.keys(config.servers)]),
    ].sort((a, b) => a.localeCompare(b));
    if (servers.length === 0) {
      lines.push(
        "Servers: none discovered (status does not start the runtime)",
      );
    } else {
      lines.push("Servers:");
      for (const server of servers) {
        const policy = Object.hasOwn(config.servers, server)
          ? config.servers[server]
          : undefined;
        const exposure = resolveServerExposure(config.defaultExposure, policy);
        const cache = catalogService.getServerStatus(server);
        const configuredOnly = runtime && !runtimeServers.includes(server);
        lines.push(
          `- ${server}: ${exposure}${policy ? " (override)" : " (default)"}` +
            `${exposure === "match" || exposure === "native" ? `, schema cache ${cache.state}` : ""}` +
            `${configuredOnly ? ", not found in MCPorter runtime" : ""}` +
            formatPolicyFilters(policy) +
            `${cache.error ? `, error: ${cache.error}` : ""}`,
        );
      }
    }

    const exposureState = lastExposureState.get(loaded.rootDir);
    if (exposureState?.pendingServers.length) {
      lines.push(
        `Discovery still running: ${exposureState.pendingServers.join(", ")}`,
      );
    }
    if (exposureState?.staleServers.length) {
      lines.push(
        `Serving stale metadata while refreshing: ${exposureState.staleServers.join(", ")}`,
      );
    }
    if (exposureState?.warnings.length) {
      lines.push("Exposure diagnostics:");
      lines.push(...exposureState.warnings.map((warning) => `- ${warning}`));
    }
    appendNativeStatus(lines, nativeStatus);
    return lines.join("\n");
  }

  function takeNewWarnings(warnings: string[]): string[] {
    return warnings.filter((warning) => {
      if (emittedWarnings.has(warning)) return false;
      emittedWarnings.add(warning);
      return true;
    });
  }

  async function shutdown(): Promise<void> {
    configFingerprints.clear();
    lastExposureState.clear();
    emittedWarnings.clear();
    await runtimeSession.shutdown();
  }

  return {
    catalogStore: catalogService.store,
    ensureRuntime: (rootDir?: string) => runtimeSession.getRuntime(rootDir),
    executeNative,
    formatStatus,
    prepareTurn,
    resolveCallTimeout,
    shutdown,
    startSession,
  };
}

function normalizeRoot(rootDir: string | undefined): string {
  return rootDir?.trim() || process.cwd();
}

function invalidConfigWarning(loaded: ConfigLoadState): string {
  return (
    `MCPorter configuration is invalid for '${loaded.rootDir}'; exposure enrichment is disabled. ` +
    `${loaded.error ?? "Unknown configuration error."} ` +
    "The mcporter proxy remains available with default call settings."
  );
}

function formatPolicyFilters(policy: ServerExposurePolicy | undefined): string {
  if (!policy) return "";
  const parts = [
    ...(policy.includeTools
      ? [`include ${policy.includeTools.join(",")}`]
      : []),
    ...(policy.excludeTools
      ? [`exclude ${policy.excludeTools.join(",")}`]
      : []),
  ];
  return parts.length > 0 ? `, ${parts.join("; ")}` : "";
}

function appendNativeStatus(
  lines: string[],
  nativeStatus: NativeToolStatus,
): void {
  lines.push(
    `Native tools active: ${nativeStatus.active.length > 0 ? nativeStatus.active.join(", ") : "none"}`,
    `Native definitions retained: ${nativeStatus.registered.length}`,
  );
  if (nativeStatus.diagnostics.length > 0) {
    lines.push("Native diagnostics:");
    lines.push(
      ...nativeStatus.diagnostics.map((diagnostic) => `- ${diagnostic}`),
    );
  }
}
