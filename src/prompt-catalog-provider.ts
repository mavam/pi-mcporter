import { shouldPreloadCatalog, type McporterMode } from "./mode.js";
import { buildMcporterSystemPromptAppend } from "./system-prompt.js";
import type { CatalogService } from "./catalog-service.js";
import type { CatalogTool } from "./types.js";
import type { RuntimeSession } from "./runtime-session.js";

export class PromptCatalogProvider {
  constructor(
    private readonly runtimeSession: RuntimeSession,
    private readonly catalogService: CatalogService,
  ) {}

  async buildSystemPromptAppend(
    modeForServer: (server: string) => McporterMode,
    rootDir?: string,
  ): Promise<string | undefined> {
    const runtime = await this.runtimeSession.getRuntime(rootDir);
    const servers = runtime
      .listServers()
      .filter((server) => modeForServer(server) !== "lazy");
    if (servers.length === 0) {
      return undefined;
    }

    const preloadServers = servers.filter((server) =>
      shouldPreloadCatalog(modeForServer(server)),
    );
    this.catalogService.startBackgroundSync(runtime, preloadServers);

    const warmedTools: CatalogTool[] = [];
    const indexServers: string[] = [];
    for (const server of servers) {
      const cachedTools = shouldPreloadCatalog(modeForServer(server))
        ? this.catalogService.getWarmedTools(server)
        : undefined;
      if (cachedTools) {
        warmedTools.push(...cachedTools);
      } else {
        indexServers.push(server);
      }
    }

    return buildMcporterSystemPromptAppend({ warmedTools, indexServers });
  }
}
