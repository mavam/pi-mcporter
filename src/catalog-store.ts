import type { Runtime, ServerToolInfo } from "mcporter";
import { CATALOG_TTL_MS } from "./constants.js";
import { toErrorMessage } from "./helpers.js";
import type { Cached, CatalogSnapshot, CatalogTool } from "./types.js";

export interface CachedCatalogOptions {
  allowStale?: boolean;
  requireSchema?: boolean;
}

export type CatalogCacheState = "cold" | "fresh" | "stale";

export class CatalogStore {
  private generation = 0;
  private basicCatalogCache: Cached<CatalogSnapshot> | undefined;
  private basicCatalogLoad: Promise<CatalogSnapshot> | undefined;

  private basicServerCatalogCache = new Map<string, Cached<CatalogTool[]>>();
  private basicServerCatalogLoads = new Map<string, Promise<CatalogTool[]>>();

  private schemaCatalogCache = new Map<string, Cached<CatalogTool[]>>();
  private schemaCatalogLoads = new Map<string, Promise<CatalogTool[]>>();

  clear(): void {
    this.generation += 1;
    this.basicCatalogCache = undefined;
    this.basicCatalogLoad = undefined;
    this.basicServerCatalogCache.clear();
    this.basicServerCatalogLoads.clear();
    this.schemaCatalogCache.clear();
    this.schemaCatalogLoads.clear();
  }

  invalidate(): void {
    this.clear();
  }

  dropSchemaServer(server: string): void {
    this.schemaCatalogCache.delete(server);
    this.schemaCatalogLoads.delete(server);
  }

  getCachedToolsForServer(
    server: string,
    options: CachedCatalogOptions = {},
  ): CatalogTool[] | undefined {
    const now = Date.now();
    const isUsable = (cached: Cached<unknown>): boolean =>
      options.allowStale === true || cached.expiresAt > now;

    const schemaCached = this.schemaCatalogCache.get(server);
    if (schemaCached && isUsable(schemaCached)) {
      return schemaCached.value;
    }

    if (options.requireSchema) {
      return undefined;
    }

    const basicCached = this.basicServerCatalogCache.get(server);
    if (basicCached && isUsable(basicCached)) {
      return basicCached.value;
    }

    if (this.basicCatalogCache && isUsable(this.basicCatalogCache)) {
      return this.basicCatalogCache.value.byServer.get(server) ?? [];
    }

    return undefined;
  }

  getSchemaCacheState(server: string): CatalogCacheState {
    const cached = this.schemaCatalogCache.get(server);
    if (!cached) return "cold";
    return cached.expiresAt > Date.now() ? "fresh" : "stale";
  }

  /**
   * Starts a schema-bearing catalog load without imposing the legacy preload
   * timeout. Callers may stop awaiting it while the request continues to warm
   * the in-memory cache.
   */
  startServerCatalogWithSchema(
    activeRuntime: Runtime,
    server: string,
  ): Promise<CatalogTool[]> {
    return this.getServerCatalogWithSchemaInternal(activeRuntime, server);
  }

  async getBasicCatalog(activeRuntime: Runtime): Promise<CatalogSnapshot> {
    const now = Date.now();
    if (this.basicCatalogCache && this.basicCatalogCache.expiresAt > now) {
      return this.basicCatalogCache.value;
    }

    if (!this.basicCatalogLoad) {
      const generation = this.generation;
      let load: Promise<CatalogSnapshot>;
      load = (async () => {
        const loadStartedAt = Date.now();
        const servers = activeRuntime.listServers();
        const byServer = new Map<string, CatalogTool[]>();
        const tools: CatalogTool[] = [];
        const warnings: string[] = [];
        const sourceFetchedAts: number[] = [];
        const sourceExpiresAts: number[] = [];

        await Promise.all(
          servers.map(async (server) => {
            const cachedTools = this.getFreshCachedEntry(
              this.basicServerCatalogCache.get(server),
            );
            if (cachedTools) {
              byServer.set(server, cachedTools.value);
              tools.push(...cachedTools.value);
              sourceFetchedAts.push(cachedTools.fetchedAt);
              sourceExpiresAts.push(cachedTools.expiresAt);
              return;
            }

            try {
              const mapped = await this.getServerCatalogBasicInternal(
                activeRuntime,
                server,
              );
              byServer.set(server, mapped);
              tools.push(...mapped);
              const refreshed = this.getFreshCachedEntry(
                this.basicServerCatalogCache.get(server),
              );
              if (refreshed) {
                sourceFetchedAts.push(refreshed.fetchedAt);
                sourceExpiresAts.push(refreshed.expiresAt);
              }
            } catch (error) {
              byServer.set(server, []);
              const warning = toErrorMessage(error);
              warnings.push(`${server}: ${warning}`);
              this.basicServerCatalogCache.delete(server);
            }
          }),
        );

        tools.sort((a, b) => a.selector.localeCompare(b.selector));
        const fetchedAt =
          sourceFetchedAts.length > 0
            ? Math.min(...sourceFetchedAts)
            : loadStartedAt;
        const expiresAt =
          sourceExpiresAts.length > 0
            ? Math.min(...sourceExpiresAts)
            : fetchedAt + CATALOG_TTL_MS;
        const snapshot: CatalogSnapshot = {
          fetchedAt,
          servers,
          tools,
          byServer,
          warnings,
        };

        if (generation === this.generation) {
          this.basicCatalogCache = {
            fetchedAt,
            value: snapshot,
            expiresAt,
          };
        }

        return snapshot;
      })().finally(() => {
        if (this.basicCatalogLoad === load) {
          this.basicCatalogLoad = undefined;
        }
      });
      this.basicCatalogLoad = load;
    }

    return this.basicCatalogLoad;
  }

  async getServerCatalogBasic(
    activeRuntime: Runtime,
    server: string,
  ): Promise<CatalogTool[]> {
    return await this.getServerCatalogBasicInternal(activeRuntime, server);
  }

  private async getServerCatalogBasicInternal(
    activeRuntime: Runtime,
    server: string,
  ): Promise<CatalogTool[]> {
    const now = Date.now();
    const cached = this.basicServerCatalogCache.get(server);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const loading = this.basicServerCatalogLoads.get(server);
    if (loading) return loading;

    const generation = this.generation;
    let promise: Promise<CatalogTool[]>;
    promise = activeRuntime
      .listTools(server, {
        includeSchema: false,
        autoAuthorize: false,
        allowCachedAuth: true,
      })
      .then((listed) => {
        const fetchedAt = Date.now();
        const mapped = listed
          .map((tool) => toCatalogTool(server, tool))
          .sort((a, b) => a.tool.localeCompare(b.tool));

        if (generation === this.generation) {
          this.basicServerCatalogCache.set(
            server,
            createCachedValue(mapped, fetchedAt),
          );
        }

        return mapped;
      })
      .finally(() => {
        if (this.basicServerCatalogLoads.get(server) === promise) {
          this.basicServerCatalogLoads.delete(server);
        }
      });

    this.basicServerCatalogLoads.set(server, promise);
    return promise;
  }

  async getServerCatalogWithSchema(
    activeRuntime: Runtime,
    server: string,
  ): Promise<CatalogTool[]> {
    return await this.getServerCatalogWithSchemaInternal(activeRuntime, server);
  }

  private async getServerCatalogWithSchemaInternal(
    activeRuntime: Runtime,
    server: string,
  ): Promise<CatalogTool[]> {
    const now = Date.now();
    const cached = this.schemaCatalogCache.get(server);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const loading = this.schemaCatalogLoads.get(server);
    if (loading) return loading;

    const generation = this.generation;
    let promise: Promise<CatalogTool[]>;
    promise = activeRuntime
      .listTools(server, {
        includeSchema: true,
        autoAuthorize: false,
        allowCachedAuth: true,
      })
      .then((listed) => {
        const fetchedAt = Date.now();
        const mapped = listed
          .map((tool) => toCatalogTool(server, tool))
          .sort((a, b) => a.tool.localeCompare(b.tool));

        if (generation === this.generation) {
          this.schemaCatalogCache.set(
            server,
            createCachedValue(mapped, fetchedAt),
          );
          this.basicServerCatalogCache.set(
            server,
            createCachedValue(mapped, fetchedAt),
          );
        }

        return mapped;
      })
      .finally(() => {
        if (this.schemaCatalogLoads.get(server) === promise) {
          this.schemaCatalogLoads.delete(server);
        }
      });

    this.schemaCatalogLoads.set(server, promise);
    return promise;
  }

  private getFreshCachedEntry<T>(
    cached: Cached<T> | undefined,
  ): Cached<T> | undefined {
    return cached && cached.expiresAt > Date.now() ? cached : undefined;
  }
}

function createCachedValue<T>(value: T, fetchedAt = Date.now()): Cached<T> {
  return {
    fetchedAt,
    expiresAt: fetchedAt + CATALOG_TTL_MS,
    value,
  };
}

function toCatalogTool(server: string, tool: ServerToolInfo): CatalogTool {
  return {
    server,
    tool: tool.name,
    selector: `${server}.${tool.name}`,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  };
}
