import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createRuntime, type Runtime } from "mcporter";
import { CatalogStore } from "./catalog-store.js";
import { toErrorMessage } from "./helpers.js";
import { registerHoistedTools } from "./hoisted-tools.js";
import { resolveCallTimeoutFromInputs } from "./inputs.js";
import { shouldPreloadCatalog } from "./mode.js";
import {
  getDefaultMcporterSettings,
  loadResolvedMcporterConfig,
  type ResolvedMcporterConfig,
} from "./settings.js";
import { preloadCatalogForMode, type PreloadSummary } from "./startup.js";
import type { CatalogTool } from "./types.js";

export interface StartupStatus {
  error?: string;
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
  const registeredHoistedSelectors = new Map<string, string>();
  const registeredHoistedNames = new Set<string>();
  const registeredToolNames = new Set<string>(["mcporter"]);
  let activeHoistedToolNames = new Set<string>();
  let pendingHoistedTools: CatalogTool[] = [];
  let resolvedConfig: ResolvedMcporterConfig | undefined;
  let resolvedConfigPromise: Promise<ResolvedMcporterConfig> | undefined;
  let runtime: Runtime | undefined;
  let runtimePromise: Promise<Runtime> | undefined;
  let preloadPromise: Promise<PreloadSummary | undefined> | undefined;
  let startupStatus: StartupStatus = { warnings: [] };
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

  async function ensurePreload(
    activeRuntime: Runtime,
  ): Promise<PreloadSummary | undefined> {
    const generation = lifecycleGeneration;
    const config = await ensureResolvedConfig();
    throwIfStale(generation);
    if (!shouldPreloadCatalog(config.mode, config.serverModes)) {
      pendingHoistedTools = [];
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
          pendingHoistedTools = summary.hoistedTools;
          return summary;
        })
        .catch((error) => {
          if (preloadPromise === promise) {
            preloadPromise = undefined;
          }
          if (!(error instanceof StaleInitializationError)) {
            pendingHoistedTools = [];
          }
          throw error;
        });
      preloadPromise = promise;
    }

    return await preloadPromise;
  }

  function registerPendingHoistedTools(): string[] {
    if (pendingHoistedTools.length === 0) {
      return [];
    }

    const { occupiedToolNames, registryAvailable } = getOccupiedToolNames();
    const hasUnnamedHoistedTools = pendingHoistedTools.some(
      (tool) => !registeredHoistedSelectors.has(tool.selector),
    );

    if (!registryAvailable && hasUnnamedHoistedTools) {
      return pendingHoistedTools.flatMap((tool) => {
        const name = registeredHoistedSelectors.get(tool.selector);
        return name ? [name] : [];
      });
    }

    const hoistedToolNames = registerHoistedTools(
      pi,
      ensureRuntime,
      catalogStore,
      pendingHoistedTools,
      resolveCallTimeout,
      registeredHoistedSelectors,
      registeredHoistedNames,
      occupiedToolNames,
    );

    for (const toolName of hoistedToolNames) {
      registeredToolNames.add(toolName);
    }

    return hoistedToolNames;
  }

  function getOccupiedToolNames(): {
    occupiedToolNames: Set<string>;
    registryAvailable: boolean;
  } {
    const occupiedToolNames = new Set(registeredToolNames);

    try {
      for (const tool of pi.getAllTools()) {
        occupiedToolNames.add(tool.name);
      }
      return { occupiedToolNames, registryAvailable: true };
    } catch {
      return { occupiedToolNames, registryAvailable: false };
    }
  }

  function syncHoistedToolActivation(nextToolNames: Iterable<string>): void {
    const desiredToolNames = new Set(nextToolNames);
    let activeToolNames: Set<string>;
    try {
      activeToolNames = new Set(pi.getActiveTools());
    } catch {
      return;
    }

    for (const toolName of activeHoistedToolNames) {
      if (!desiredToolNames.has(toolName)) {
        activeToolNames.delete(toolName);
      }
    }

    for (const toolName of desiredToolNames) {
      activeToolNames.add(toolName);
    }

    try {
      pi.setActiveTools([...activeToolNames]);
      activeHoistedToolNames = desiredToolNames;
    } catch {
      // Pi may not expose an active-tool registry yet during early startup.
    }
  }

  async function warmup(): Promise<StartupStatus> {
    if (warmupPromise) {
      return await warmupPromise;
    }

    const generation = lifecycleGeneration;
    let promise: Promise<StartupStatus>;
    promise = (async () => {
      startupStatus = { warnings: [] };

      try {
        const activeRuntime = await ensureRuntime();
        const preloadSummary = await ensurePreload(activeRuntime);
        throwIfStale(generation);
        startupStatus = {
          warnings: preloadSummary?.warnings ?? [],
        };
      } catch (error) {
        if (error instanceof StaleInitializationError) {
          return startupStatus;
        }
        pendingHoistedTools = [];
        startupStatus = {
          error: toErrorMessage(error),
          warnings: [],
        };
      }

      throwIfStale(generation);
      syncHoistedToolActivation(registerPendingHoistedTools());
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
      const config = await ensureResolvedConfig();
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

  async function shutdown(): Promise<void> {
    lifecycleGeneration += 1;
    const activeRuntime = runtime;
    runtime = undefined;
    runtimePromise = undefined;
    resolvedConfig = undefined;
    resolvedConfigPromise = undefined;
    preloadPromise = undefined;
    warmupPromise = undefined;
    pendingHoistedTools = [];
    startupStatus = { warnings: [] };
    catalogStore.clear();
    syncHoistedToolActivation([]);

    if (activeRuntime) {
      await activeRuntime.close().catch(() => {});
    }
  }

  return {
    catalogStore,
    ensureRuntime,
    getStartupMessages,
    resolveCallTimeout,
    shutdown,
    shouldWarmupBeforeAgentStart,
    warmup,
  };
}
