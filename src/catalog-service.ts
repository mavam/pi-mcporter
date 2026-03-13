import type { Runtime } from "mcporter";
import { CatalogStore } from "./catalog-store.js";
import { preloadCatalog } from "./startup.js";
import type { CatalogTool } from "./types.js";

export class CatalogService {
  constructor(readonly store: CatalogStore = new CatalogStore()) {}

  async ensurePromptCatalog(runtime: Runtime): Promise<CatalogTool[]> {
    await preloadCatalog(runtime, this.store);

    const tools: CatalogTool[] = [];
    for (const server of runtime.listServers()) {
      const cachedTools = this.store.getCachedToolsForServer(server);
      if (cachedTools) {
        tools.push(...cachedTools);
      }
    }

    return tools;
  }

  clear(): void {
    this.store.clear();
  }
}
