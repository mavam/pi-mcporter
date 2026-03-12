import type { Runtime, ServerToolInfo } from "mcporter";
import {
  CATALOG_TTL_MS,
  DEFAULT_CATALOG_LIST_TIMEOUT_MS,
} from "./constants.js";
import { toErrorMessage } from "./helpers.js";
import type { Cached, CatalogSnapshot, CatalogTool } from "./types.js";

export interface CatalogStoreOptions {
  listTimeoutMs?: number;
}

interface CatalogLoad<T> {
  promise: Promise<T>;
  timeoutMs: number | undefined;
}

export class CatalogStore {
  private readonly listTimeoutMs: number;
  private basicCatalogCache: Cached<CatalogSnapshot> | undefined;
  private basicCatalogLoad: Promise<CatalogSnapshot> | undefined;

  private basicServerCatalogCache = new Map<string, Cached<CatalogTool[]>>();
  private basicServerCatalogLoads = new Map<
    string,
    CatalogLoad<CatalogTool[]>
  >();

  private schemaCatalogCache = new Map<string, Cached<CatalogTool[]>>();
  private schemaCatalogLoads = new Map<string, CatalogLoad<CatalogTool[]>>();

  constructor(options: CatalogStoreOptions = {}) {
    this.listTimeoutMs =
      options.listTimeoutMs ?? DEFAULT_CATALOG_LIST_TIMEOUT_MS;
  }

  clear(): void {
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

  getCachedToolsForServer(server: string): CatalogTool[] | undefined {
    const now = Date.now();

    const schemaCached = this.schemaCatalogCache.get(server);
    if (schemaCached && schemaCached.expiresAt > now) {
      return schemaCached.value;
    }

    const basicCached = this.basicServerCatalogCache.get(server);
    if (basicCached && basicCached.expiresAt > now) {
      return basicCached.value;
    }

    if (this.basicCatalogCache && this.basicCatalogCache.expiresAt > now) {
      return this.basicCatalogCache.value.byServer.get(server) ?? [];
    }

    return undefined;
  }

  async getBasicCatalog(activeRuntime: Runtime): Promise<CatalogSnapshot> {
    const now = Date.now();
    if (this.basicCatalogCache && this.basicCatalogCache.expiresAt > now) {
      return this.basicCatalogCache.value;
    }

    if (!this.basicCatalogLoad) {
      this.basicCatalogLoad = (async () => {
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

        this.basicCatalogCache = {
          fetchedAt,
          value: snapshot,
          expiresAt,
        };

        return snapshot;
      })().finally(() => {
        this.basicCatalogLoad = undefined;
      });
    }

    return this.basicCatalogLoad;
  }

  async getServerCatalogBasic(
    activeRuntime: Runtime,
    server: string,
  ): Promise<CatalogTool[]> {
    return await this.getServerCatalogBasicInternal(activeRuntime, server);
  }

  async preloadServerCatalogBasic(
    activeRuntime: Runtime,
    server: string,
  ): Promise<CatalogTool[]> {
    return await this.getServerCatalogBasicInternal(
      activeRuntime,
      server,
      this.listTimeoutMs,
    );
  }

  private async getServerCatalogBasicInternal(
    activeRuntime: Runtime,
    server: string,
    timeoutMs?: number,
  ): Promise<CatalogTool[]> {
    const now = Date.now();
    const cached = this.basicServerCatalogCache.get(server);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const loading = this.basicServerCatalogLoads.get(server);
    if (loading && hasMatchingTimeoutProfile(loading.timeoutMs, timeoutMs)) {
      return loading.promise;
    }

    const load = this.listToolsWithTimeout(
      activeRuntime,
      server,
      {
        includeSchema: false,
        autoAuthorize: false,
        allowCachedAuth: true,
      },
      timeoutMs,
    )
      .then((listed) => {
        const fetchedAt = Date.now();
        const mapped = listed
          .map((tool) => toCatalogTool(server, tool))
          .sort((a, b) => a.tool.localeCompare(b.tool));

        this.basicServerCatalogCache.set(
          server,
          createCachedValue(mapped, fetchedAt),
        );

        return mapped;
      })
      .finally(() => {
        this.basicServerCatalogLoads.delete(server);
      });

    this.basicServerCatalogLoads.set(server, {
      promise: load,
      timeoutMs,
    });
    return load;
  }

  async getServerCatalogWithSchema(
    activeRuntime: Runtime,
    server: string,
  ): Promise<CatalogTool[]> {
    return await this.getServerCatalogWithSchemaInternal(activeRuntime, server);
  }

  async preloadServerCatalogWithSchema(
    activeRuntime: Runtime,
    server: string,
  ): Promise<CatalogTool[]> {
    return await this.getServerCatalogWithSchemaInternal(
      activeRuntime,
      server,
      this.listTimeoutMs,
    );
  }

  private async getServerCatalogWithSchemaInternal(
    activeRuntime: Runtime,
    server: string,
    timeoutMs?: number,
  ): Promise<CatalogTool[]> {
    const now = Date.now();
    const cached = this.schemaCatalogCache.get(server);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const loading = this.schemaCatalogLoads.get(server);
    if (loading && hasMatchingTimeoutProfile(loading.timeoutMs, timeoutMs)) {
      return loading.promise;
    }

    const load = this.listToolsWithTimeout(
      activeRuntime,
      server,
      {
        includeSchema: true,
        autoAuthorize: false,
        allowCachedAuth: true,
      },
      timeoutMs,
    )
      .then((listed) => {
        const fetchedAt = Date.now();
        const mapped = listed
          .map((tool) => toCatalogTool(server, tool))
          .sort((a, b) => a.tool.localeCompare(b.tool));

        this.schemaCatalogCache.set(
          server,
          createCachedValue(mapped, fetchedAt),
        );
        this.basicServerCatalogCache.set(
          server,
          createCachedValue(mapped, fetchedAt),
        );

        return mapped;
      })
      .finally(() => {
        this.schemaCatalogLoads.delete(server);
      });

    this.schemaCatalogLoads.set(server, {
      promise: load,
      timeoutMs,
    });
    return load;
  }

  private async listToolsWithTimeout(
    activeRuntime: Runtime,
    server: string,
    options: Parameters<Runtime["listTools"]>[1],
    timeoutMs?: number,
  ): Promise<ServerToolInfo[]> {
    const request = activeRuntime.listTools(server, options);
    return await raceWithTimeout(
      request,
      timeoutMs,
      `Timed out loading MCP tool catalog for '${server}' after ${timeoutMs}ms.`,
    );
  }

  private getFreshCachedEntry<T>(
    cached: Cached<T> | undefined,
  ): Cached<T> | undefined {
    return cached && cached.expiresAt > Date.now() ? cached : undefined;
  }
}

function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  message: string,
): Promise<T> {
  if (
    timeoutMs === undefined ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return promise;
  }

  const effectiveTimeoutMs = timeoutMs;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, effectiveTimeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function hasMatchingTimeoutProfile(
  currentTimeoutMs: number | undefined,
  requestedTimeoutMs: number | undefined,
): boolean {
  return currentTimeoutMs === requestedTimeoutMs;
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
