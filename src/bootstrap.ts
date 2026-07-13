import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CatalogService } from "./catalog-service.js";
import { resolveCallTimeoutFromInputs } from "./inputs.js";
import { resolveServerMode } from "./mode.js";
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
    onRuntimeInvalidated: () => catalogService.clear(),
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

  async function resolveCallTimeout(override?: number): Promise<number> {
    const config = await ensureResolvedConfig().catch(() => defaultSettings);
    return resolveCallTimeoutFromInputs(override, String(config.timeoutMs));
  }

  async function buildSystemPromptAppend(
    rootDir?: string,
  ): Promise<string | undefined> {
    try {
      const config = await ensureResolvedConfig();
      const anyVisible =
        config.mode !== "lazy" ||
        Object.values(config.serverModes ?? {}).some((mode) => mode !== "lazy");
      if (!anyVisible) {
        return undefined;
      }

      return await promptCatalogProvider.buildSystemPromptAppend(
        (server) =>
          resolveServerMode(config.mode, config.serverModes?.[server]),
        rootDir,
      );
    } catch {
      return undefined;
    }
  }

  async function shutdown(): Promise<void> {
    resolvedConfig = undefined;
    resolvedConfigPromise = undefined;
    await runtimeSession.shutdown();
  }

  return {
    catalogStore: catalogService.store,
    buildSystemPromptAppend,
    ensureRuntime: (rootDir?: string) => runtimeSession.getRuntime(rootDir),
    resolveCallTimeout,
    shutdown,
  };
}
