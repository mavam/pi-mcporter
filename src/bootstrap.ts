import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CatalogService } from "./catalog-service.js";
import { resolveCallTimeoutFromInputs } from "./inputs.js";
import { shouldPreloadCatalog } from "./mode.js";
import { PromptCatalogProvider } from "./prompt-catalog-provider.js";
import {
  getDefaultMcporterSettings,
  loadResolvedMcporterConfig,
  type ResolvedMcporterConfig,
} from "./settings.js";
import {
  RuntimeSession,
  type RuntimeSessionOptions,
} from "./runtime-session.js";

type CreateMcporterControllerOptions = {
  catalogService?: CatalogService;
  createRuntimeFn?: RuntimeSessionOptions["createRuntimeFn"];
  packageVersion: string;
};

export function createMcporterController(
  _pi: ExtensionAPI,
  options: CreateMcporterControllerOptions,
) {
  const defaultSettings = getDefaultMcporterSettings();
  const catalogService = options.catalogService ?? new CatalogService();
  let resolvedConfig: ResolvedMcporterConfig | undefined;
  let resolvedConfigPromise: Promise<ResolvedMcporterConfig> | undefined;

  const runtimeSession = new RuntimeSession({
    createRuntimeFn: options.createRuntimeFn,
    getRuntimeConfigPath: async () =>
      (await ensureResolvedConfig()).runtimeConfigPath,
    packageVersion: options.packageVersion,
  });
  const promptCatalogProvider = new PromptCatalogProvider(
    runtimeSession,
    catalogService,
  );

  async function ensureResolvedConfig(): Promise<ResolvedMcporterConfig> {
    if (resolvedConfig) {
      return resolvedConfig;
    }

    if (!resolvedConfigPromise) {
      let promise: Promise<ResolvedMcporterConfig>;
      promise = loadResolvedMcporterConfig()
        .then((loaded) => {
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

  function resolveCallTimeout(override?: number): number {
    return resolveCallTimeoutFromInputs(
      override,
      String(resolvedConfig?.timeoutMs ?? defaultSettings.timeoutMs),
    );
  }

  async function buildSystemPromptAppend(): Promise<string | undefined> {
    try {
      const config = await ensureResolvedConfig();
      if (!shouldPreloadCatalog(config.mode)) {
        return undefined;
      }

      return await promptCatalogProvider.buildSystemPromptAppend();
    } catch {
      return undefined;
    }
  }

  async function shutdown(): Promise<void> {
    resolvedConfig = undefined;
    resolvedConfigPromise = undefined;
    catalogService.clear();
    await runtimeSession.shutdown();
  }

  return {
    catalogStore: catalogService.store,
    buildSystemPromptAppend,
    ensureRuntime: () => runtimeSession.getRuntime(),
    resolveCallTimeout,
    shutdown,
  };
}
