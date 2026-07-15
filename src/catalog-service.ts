import type { Runtime } from "mcporter";
import { CatalogStore, type CatalogCacheState } from "./catalog-store.js";
import { toErrorMessage } from "./helpers.js";
import type { CatalogTool } from "./types.js";

export interface PreparedSchemaCatalogs {
  byServer: Map<string, CatalogTool[]>;
  pendingServers: string[];
  staleServers: string[];
  warnings: string[];
}

export interface CatalogServerStatus {
  error?: string;
  state: CatalogCacheState;
}

export class CatalogService {
  private generation = 0;
  private readonly schemaErrors = new Map<string, string>();

  constructor(readonly store: CatalogStore = new CatalogStore()) {}

  startBackgroundSchemaSync(runtime: Runtime, servers: string[]): void {
    for (const server of uniqueSorted(servers)) {
      if (this.store.getSchemaCacheState(server) === "fresh") {
        continue;
      }
      void this.trackSchemaLoad(runtime, server).catch(() => {});
    }
  }

  /**
   * Returns fresh or stale schema metadata immediately. Cold servers share one
   * overall wait budget; their loads keep running after that budget expires.
   */
  async prepareSchemaCatalogs(
    runtime: Runtime,
    servers: string[],
    timeoutMs: number,
  ): Promise<PreparedSchemaCatalogs> {
    const requested = uniqueSorted(servers);
    const coldLoads: Promise<void>[] = [];
    const staleCandidates: string[] = [];

    for (const server of requested) {
      const state = this.store.getSchemaCacheState(server);
      if (state === "fresh") {
        continue;
      }

      const load = this.trackSchemaLoad(runtime, server).then(() => undefined);
      if (state === "stale") {
        staleCandidates.push(server);
        // Stale metadata is served without waiting for the refresh, but the
        // background promise still needs a rejection handler.
        void load.catch(() => {});
      } else {
        coldLoads.push(load);
      }
    }

    await waitForAllWithin(coldLoads, timeoutMs);

    const staleServers = staleCandidates.filter(
      (server) => this.store.getSchemaCacheState(server) !== "fresh",
    );

    const byServer = new Map<string, CatalogTool[]>();
    const pendingServers: string[] = [];
    for (const server of requested) {
      const tools = this.store.getCachedToolsForServer(server, {
        allowStale: true,
        requireSchema: true,
      });
      if (tools) {
        byServer.set(server, tools);
      } else if (!this.schemaErrors.has(server)) {
        pendingServers.push(server);
      }
    }

    const warnings = requested.flatMap((server) => {
      const error = this.schemaErrors.get(server);
      return error ? [`${server}: ${error}`] : [];
    });

    return {
      byServer,
      pendingServers,
      staleServers,
      warnings,
    };
  }

  getServerStatus(server: string): CatalogServerStatus {
    const error = this.schemaErrors.get(server);
    return {
      state: this.store.getSchemaCacheState(server),
      ...(error ? { error } : {}),
    };
  }

  clear(): void {
    this.generation += 1;
    this.schemaErrors.clear();
    this.store.clear();
  }

  private async trackSchemaLoad(
    runtime: Runtime,
    server: string,
  ): Promise<CatalogTool[]> {
    const generation = this.generation;
    try {
      const tools = await this.store.startServerCatalogWithSchema(
        runtime,
        server,
      );
      if (generation === this.generation) {
        this.schemaErrors.delete(server);
      }
      return tools;
    } catch (error) {
      if (generation === this.generation) {
        this.schemaErrors.set(server, toErrorMessage(error));
      }
      throw error;
    }
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

async function waitForAllWithin(
  promises: Promise<void>[],
  timeoutMs: number,
): Promise<void> {
  if (promises.length === 0) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([
    Promise.allSettled(promises).then(() => undefined),
    timeout,
  ]);
  if (timer) clearTimeout(timer);
}
