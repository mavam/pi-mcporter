import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createRuntime, type Runtime } from "mcporter";
import { CatalogStore } from "./catalog-store.js";
import { toErrorMessage } from "./helpers.js";
import { resolveCallTimeoutFromInputs } from "./inputs.js";
import { resolveServerMode, shouldPreloadCatalog } from "./mode.js";
import {
  getDefaultMcporterSettings,
  loadResolvedMcporterConfig,
  type ResolvedMcporterConfig,
} from "./settings.js";
import { preloadCatalogForMode, type PreloadSummary } from "./startup.js";
import { buildCatalogSystemPromptAppend } from "./system-prompt.js";
import {
  createToolExposureManager,
  type EffectiveResolvedMcporterConfig,
} from "./tool-exposure.js";
import type { CatalogTool } from "./types.js";

export interface StartupStatus {
  error?: string;
  notices: string[];
  warnings: string[];
}

type CreateMcporterControllerOptions = {
  catalogStore?: CatalogStore;
  createRuntimeFn?: typeof createRuntime;
  packageVersion: string;
};

class StaleInitializationError extends Error {
  constructor() {
    super("Stale initialization result.");
  }
}

export function createMcporterController(
  pi: ExtensionAPI,
  options: CreateMcporterControllerOptions,
) {
  const catalogStore = options.catalogStore ?? new CatalogStore();
  const createRuntimeFn = options.createRuntimeFn ?? createRuntime;
  const defaultSettings = getDefaultMcporterSettings();
  const toolExposure = createToolExposureManager(pi);
  let resolvedConfig: ResolvedMcporterConfig | undefined;
  let effectiveConfig: EffectiveResolvedMcporterConfig | undefined;
  let resolvedConfigPromise: Promise<ResolvedMcporterConfig> | undefined;
  let runtime: Runtime | undefined;
  let runtimePromise: Promise<Runtime> | undefined;
  let preloadPromise: Promise<PreloadSummary | undefined> | undefined;
  let startupStatus: StartupStatus = { notices: [], warnings: [] };
  let warmupPromise: Promise<StartupStatus> | undefined;
  let lifecycleGeneration = 0;

  function throwIfStale(generation: number): void {
    if (generation !== lifecycleGeneration) {
      throw new StaleInitializationError();
    }
  }

  async function ensureResolvedConfig(): Promise<ResolvedMcporterConfig> {
    if (resolvedConfig) {
      return resolvedConfig;
    }

    if (!resolvedConfigPromise) {
      const generation = lifecycleGeneration;
      let promise: Promise<ResolvedMcporterConfig>;
      promise = loadResolvedMcporterConfig()
        .then((loaded) => {
          throwIfStale(generation);
          resolvedConfig = loaded;
          return loaded;
        })
        .catch((error) => {
          if (resolvedConfigPromise === promise) {
            resolvedConfigPromise = undefined;
          }
          throw error;
        });
      resolvedConfigPromise = promise;
    }

    return await resolvedConfigPromise;
  }

  async function ensureRuntime(): Promise<Runtime> {
    if (runtime) {
      return runtime;
    }

    if (!runtimePromise) {
      const generation = lifecycleGeneration;
      let promise: Promise<Runtime>;
      promise = ensureResolvedConfig()
        .then((config) => {
          throwIfStale(generation);
          return createRuntimeFn({
            ...(config.runtimeConfigPath
              ? { configPath: config.runtimeConfigPath }
              : {}),
            clientInfo: {
              name: "pi-mcporter",
              version: options.packageVersion,
            },
          });
        })
        .then(async (created) => {
          if (generation !== lifecycleGeneration) {
            await created.close().catch(() => {});
            throw new StaleInitializationError();
          }
          runtime = created;
          return created;
        })
        .catch((error) => {
          if (runtimePromise === promise) {
            runtimePromise = undefined;
          }
          throw error;
        });
      runtimePromise = promise;
    }

    return await runtimePromise;
  }

  async function ensureEffectiveConfig(): Promise<EffectiveResolvedMcporterConfig> {
    if (effectiveConfig) {
      return effectiveConfig;
    }

    const config = await ensureResolvedConfig();
    effectiveConfig = toolExposure.resolveEffectiveConfig(config);
    return effectiveConfig;
  }

  async function ensurePreload(
    activeRuntime: Runtime,
  ): Promise<PreloadSummary | undefined> {
    const generation = lifecycleGeneration;
    const config = await ensureEffectiveConfig();
    throwIfStale(generation);
    if (!shouldPreloadCatalog(config.mode, config.serverModes)) {
      return undefined;
    }

    if (!preloadPromise) {
      let promise: Promise<PreloadSummary | undefined>;
      promise = preloadCatalogForMode(
        activeRuntime,
        catalogStore,
        config.mode,
        config.serverModes,
      )
        .then((summary) => {
          throwIfStale(generation);
          return summary;
        })
        .catch((error) => {
          if (preloadPromise === promise) {
            preloadPromise = undefined;
          }
          throw error;
        });
      preloadPromise = promise;
    }

    return await preloadPromise;
  }

  async function warmup(): Promise<StartupStatus> {
    if (warmupPromise) {
      return await warmupPromise;
    }

    const generation = lifecycleGeneration;
    let promise: Promise<StartupStatus>;
    promise = (async () => {
      startupStatus = { notices: [], warnings: [] };

      try {
        const config = await ensureEffectiveConfig();
        const activeRuntime = await ensureRuntime();
        const preloadSummary = await ensurePreload(activeRuntime);
        throwIfStale(generation);
        startupStatus = {
          notices: [...config.exposureWarnings],
          warnings: preloadSummary?.warnings ?? [],
        };
      } catch (error) {
        if (error instanceof StaleInitializationError) {
          return startupStatus;
        }
        const notices = effectiveConfig?.exposureWarnings ?? [];
        startupStatus = {
          error: toErrorMessage(error),
          notices: [...notices],
          warnings: [],
        };
      }

      throwIfStale(generation);
      return startupStatus;
    })().finally(() => {
      if (warmupPromise === promise) {
        warmupPromise = undefined;
      }
    });
    warmupPromise = promise;

    return await warmupPromise;
  }

  async function shouldWarmupBeforeAgentStart(): Promise<boolean> {
    try {
      const config = await ensureEffectiveConfig();
      return shouldPreloadCatalog(config.mode, config.serverModes);
    } catch {
      return true;
    }
  }

  function getStartupMessages(status: StartupStatus = startupStatus): string[] {
    const messages: string[] = [];

    if (status.error) {
      messages.push(`mcporter extension: ${status.error}`);
    }
    for (const notice of status.notices) {
      messages.push(`mcporter extension: ${notice}`);
    }
    if (status.warnings.length > 0) {
      messages.push(
        `mcporter extension: metadata unavailable for ${status.warnings.length} server(s).`,
      );
    }

    return messages;
  }

  function resolveCallTimeout(override?: number): number {
    return resolveCallTimeoutFromInputs(
      override,
      String(resolvedConfig?.timeoutMs ?? defaultSettings.timeoutMs),
    );
  }

  async function buildSystemPromptAppend(): Promise<string | undefined> {
    try {
      const config = await ensureEffectiveConfig();
      if (!shouldPreloadCatalog(config.mode, config.serverModes)) {
        return undefined;
      }

      const activeRuntime = await ensureRuntime();
      await ensurePreload(activeRuntime);

      const tools: CatalogTool[] = [];
      for (const server of activeRuntime.listServers()) {
        if (
          resolveServerMode(config.mode, config.serverModes, server) === "lazy"
        ) {
          continue;
        }
        const cachedTools = catalogStore.getCachedToolsForServer(server);
        if (cachedTools) {
          tools.push(...cachedTools);
        }
      }

      return buildCatalogSystemPromptAppend(tools);
    } catch {
      return undefined;
    }
  }

  async function shutdown(): Promise<void> {
    lifecycleGeneration += 1;
    const activeRuntime = runtime;
    runtime = undefined;
    runtimePromise = undefined;
    resolvedConfig = undefined;
    effectiveConfig = undefined;
    resolvedConfigPromise = undefined;
    preloadPromise = undefined;
    warmupPromise = undefined;
    startupStatus = { notices: [], warnings: [] };
    catalogStore.clear();
    toolExposure.releaseSessionTools();

    if (activeRuntime) {
      await activeRuntime.close().catch(() => {});
    }
  }

  return {
    catalogStore,
    buildSystemPromptAppend,
    ensureRuntime,
    getStartupMessages,
    resolveCallTimeout,
    shutdown,
    shouldWarmupBeforeAgentStart,
    warmup,
  };
}
