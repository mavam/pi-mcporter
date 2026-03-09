import type { Runtime } from "mcporter";
import type { CatalogStore } from "./catalog-store.js";
import { toErrorMessage } from "./helpers.js";
import { type McporterMode, shouldHoistTools } from "./mode.js";
import type { CatalogTool } from "./types.js";

export interface PreloadSummary {
  mode: McporterMode;
  serverCount: number;
  warmedServers: string[];
  hoistedTools: CatalogTool[];
  warnings: string[];
}

export async function preloadCatalogForMode(
  activeRuntime: Runtime,
  catalogStore: CatalogStore,
  mode: McporterMode,
): Promise<PreloadSummary> {
  const servers = activeRuntime.listServers();
  if (!shouldHoistTools(mode)) {
    const catalog = await catalogStore.getBasicCatalog(activeRuntime);
    const warnedServers = new Set(
      catalog.warnings
        .map((warning) => warning.split(":", 1)[0]?.trim())
        .filter((server): server is string => Boolean(server)),
    );

    return {
      mode,
      serverCount: catalog.servers.length,
      warmedServers: catalog.servers.filter((server) => !warnedServers.has(server)),
      hoistedTools: [],
      warnings: [...catalog.warnings].sort((a, b) => a.localeCompare(b)),
    };
  }

  const warnings: string[] = [];
  const warmedServers: string[] = [];
  const hoistedTools: CatalogTool[] = [];

  await Promise.all(
    servers.map(async (server) => {
      try {
        const tools = await catalogStore.getServerCatalogWithSchema(
          activeRuntime,
          server,
        );
        warmedServers.push(server);
        hoistedTools.push(...tools);
      } catch (error) {
        catalogStore.dropSchemaServer(server);
        warnings.push(`${server}: ${toErrorMessage(error)}`);
      }
    }),
  );

  warmedServers.sort((a, b) => a.localeCompare(b));
  hoistedTools.sort((a, b) => a.selector.localeCompare(b.selector));
  warnings.sort((a, b) => a.localeCompare(b));

  return {
    mode,
    serverCount: servers.length,
    warmedServers,
    hoistedTools,
    warnings,
  };
}
