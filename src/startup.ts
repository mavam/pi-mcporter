import type { Runtime } from "mcporter";
import type { CatalogStore } from "./catalog-store.js";
import { toErrorMessage } from "./helpers.js";
import { resolveServerMode, type McporterMode } from "./mode.js";
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
  serverModes: Readonly<Record<string, McporterMode>> = {},
): Promise<PreloadSummary> {
  const servers = activeRuntime.listServers();
  const warnings: string[] = [];
  const warmedServers: string[] = [];
  const hoistedTools: CatalogTool[] = [];

  await Promise.all(
    servers.map(async (server) => {
      const serverMode = resolveServerMode(mode, serverModes, server);
      if (serverMode === "lazy") {
        return;
      }

      try {
        const tools =
          serverMode === "direct"
            ? await catalogStore.preloadServerCatalogWithSchema(
                activeRuntime,
                server,
              )
            : await catalogStore.preloadServerCatalogBasic(
                activeRuntime,
                server,
              );
        warmedServers.push(server);
        if (serverMode === "direct") {
          hoistedTools.push(...tools);
        }
      } catch (error) {
        if (serverMode === "direct") {
          catalogStore.dropSchemaServer(server);
        }
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
