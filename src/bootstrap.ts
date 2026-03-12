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

  async function ensureResolvedConfig(): Promise<ResolvedMcporterConfig> {
    if (resolvedConfig) {
      return resolvedConfig;
    }

    if (!resolvedConfigPromise) {
      resolvedConfigPromise = loadResolvedMcporterConfig()
        .then((loaded) => {
          resolvedConfig = loaded;
          return loaded;
        })
        .catch((error) => {
          resolvedConfigPromise = undefined;
          throw error;
        });
    }

    return await resolvedConfigPromise;
  }

  async function ensureRuntime(): Promise<Runtime> {
    if (runtime) {
      return runtime;
    }

    if (!runtimePromise) {
      runtimePromise = ensureResolvedConfig()
        .then((config) =>
          createRuntimeFn({
            ...(config.runtimeConfigPath
              ? { configPath: config.runtimeConfigPath }
              : {}),
            clientInfo: {
              name: "pi-mcporter",
              version: options.packageVersion,
            },
          }),
        )
        .then((created) => {
          runtime = created;
          return created;
        })
        .catch((error) => {
          runtimePromise = undefined;
          throw error;
        });
    }

    return await runtimePromise;
  }

  async function ensurePreload(
    activeRuntime: Runtime,
  ): Promise<PreloadSummary | undefined> {
    const config = await ensureResolvedConfig();
    if (!shouldPreloadCatalog(config.mode, config.serverModes)) {
      pendingHoistedTools = [];
      return undefined;
    }

    if (!preloadPromise) {
      preloadPromise = preloadCatalogForMode(
        activeRuntime,
        catalogStore,
        config.mode,
        config.serverModes,
      )
        .then((summary) => {
          pendingHoistedTools = summary.hoistedTools;
          return summary;
        })
        .catch((error) => {
          preloadPromise = undefined;
          pendingHoistedTools = [];
          throw error;
        });
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
    const activeToolNames = new Set(pi.getActiveTools());

    for (const toolName of activeHoistedToolNames) {
      if (!desiredToolNames.has(toolName)) {
        activeToolNames.delete(toolName);
      }
    }

    for (const toolName of desiredToolNames) {
      activeToolNames.add(toolName);
    }

    activeHoistedToolNames = desiredToolNames;
    pi.setActiveTools([...activeToolNames]);
  }

  async function warmup(): Promise<StartupStatus> {
    if (warmupPromise) {
      return await warmupPromise;
    }

    warmupPromise = (async () => {
      startupStatus = { warnings: [] };

      try {
        const activeRuntime = await ensureRuntime();
        const preloadSummary = await ensurePreload(activeRuntime);
        startupStatus = {
          warnings: preloadSummary?.warnings ?? [],
        };
      } catch (error) {
        pendingHoistedTools = [];
        startupStatus = {
          error: toErrorMessage(error),
          warnings: [],
        };
      }

      syncHoistedToolActivation(registerPendingHoistedTools());
      return startupStatus;
    })().finally(() => {
      warmupPromise = undefined;
    });

    return await warmupPromise;
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
    const activeRuntime = runtime;
    runtime = undefined;
    runtimePromise = undefined;
    resolvedConfig = undefined;
    resolvedConfigPromise = undefined;
    preloadPromise = undefined;
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
    warmup,
  };
}
