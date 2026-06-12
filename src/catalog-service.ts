import type { Runtime } from "mcporter";
import { CatalogStore } from "./catalog-store.js";
import { preloadCatalog } from "./startup.js";
import type { CatalogTool } from "./types.js";

export class CatalogService {
  constructor(readonly store: CatalogStore = new CatalogStore()) {}

  startBackgroundSync(runtime: Runtime, servers: string[]): void {
    if (servers.length === 0) {
      return;
    }

    const serverSet = new Set(servers);
    void preloadCatalog(runtime, this.store, (server) =>
      serverSet.has(server),
    ).catch(() => {});
  }

  getWarmedTools(server: string): CatalogTool[] | undefined {
    return this.store.getCachedToolsForServer(server);
  }

  clear(): void {
    this.store.clear();
  }
}
