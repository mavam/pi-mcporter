import type { Runtime } from "mcporter";
import type { CatalogStore } from "./catalog-store.js";
import { toErrorMessage } from "./helpers.js";

export interface PreloadSummary {
  serverCount: number;
  warmedServers: string[];
  warnings: string[];
}

export async function preloadCatalog(
  activeRuntime: Runtime,
  catalogStore: CatalogStore,
): Promise<PreloadSummary> {
  const servers = activeRuntime.listServers();
  const warnings: string[] = [];
  const warmedServers: string[] = [];

  await Promise.all(
    servers.map(async (server) => {
      try {
        await catalogStore.preloadServerCatalogBasic(activeRuntime, server);
        warmedServers.push(server);
      } catch (error) {
        warnings.push(`${server}: ${toErrorMessage(error)}`);
      }
    }),
  );

  warmedServers.sort((a, b) => a.localeCompare(b));
  warnings.sort((a, b) => a.localeCompare(b));

  return {
    serverCount: servers.length,
    warmedServers,
    warnings,
  };
}
