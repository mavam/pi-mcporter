import type { Runtime, ServerToolInfo } from "mcporter";
import { CATALOG_TTL_MS } from "./constants.js";
import { toErrorMessage } from "./helpers.js";
import type { Cached, CatalogSnapshot, CatalogTool } from "./types.js";

export class CatalogStore {
	private basicCatalogCache: Cached<CatalogSnapshot> | undefined;
	private basicCatalogLoad: Promise<CatalogSnapshot> | undefined;

	private basicServerCatalogCache = new Map<string, Cached<CatalogTool[]>>();
	private basicServerCatalogLoads = new Map<string, Promise<CatalogTool[]>>();

	private schemaCatalogCache = new Map<string, Cached<CatalogTool[]>>();
	private schemaCatalogLoads = new Map<string, Promise<CatalogTool[]>>();

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
				const fetchedAt = Date.now();
				const servers = activeRuntime.listServers();
				const byServer = new Map<string, CatalogTool[]>();
				const tools: CatalogTool[] = [];
				const warnings: string[] = [];

				await Promise.all(
					servers.map(async (server) => {
						try {
							const listed = await activeRuntime.listTools(server, {
								includeSchema: false,
								autoAuthorize: false,
								allowCachedAuth: true,
							});
							const mapped = listed
								.map((tool) => toCatalogTool(server, tool))
								.sort((a, b) => a.tool.localeCompare(b.tool));

							byServer.set(server, mapped);
							tools.push(...mapped);
							this.basicServerCatalogCache.set(server, {
								value: mapped,
								expiresAt: fetchedAt + CATALOG_TTL_MS,
							});
						} catch (error) {
							byServer.set(server, []);
							warnings.push(`${server}: ${toErrorMessage(error)}`);
							this.basicServerCatalogCache.delete(server);
						}
					}),
				);

				tools.sort((a, b) => a.selector.localeCompare(b.selector));
				const snapshot: CatalogSnapshot = {
					fetchedAt,
					servers,
					tools,
					byServer,
					warnings,
				};

				this.basicCatalogCache = {
					value: snapshot,
					expiresAt: fetchedAt + CATALOG_TTL_MS,
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
		const now = Date.now();
		const cached = this.basicServerCatalogCache.get(server);
		if (cached && cached.expiresAt > now) {
			return cached.value;
		}

		const loading = this.basicServerCatalogLoads.get(server);
		if (loading) {
			return loading;
		}

		const load = activeRuntime
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

				this.basicServerCatalogCache.set(server, {
					value: mapped,
					expiresAt: fetchedAt + CATALOG_TTL_MS,
				});

				return mapped;
			})
			.finally(() => {
				this.basicServerCatalogLoads.delete(server);
			});

		this.basicServerCatalogLoads.set(server, load);
		return load;
	}

	async getServerCatalogWithSchema(
		activeRuntime: Runtime,
		server: string,
	): Promise<CatalogTool[]> {
		const now = Date.now();
		const cached = this.schemaCatalogCache.get(server);
		if (cached && cached.expiresAt > now) {
			return cached.value;
		}

		const loading = this.schemaCatalogLoads.get(server);
		if (loading) {
			return loading;
		}

		const load = activeRuntime
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

				this.schemaCatalogCache.set(server, {
					value: mapped,
					expiresAt: fetchedAt + CATALOG_TTL_MS,
				});
				this.basicServerCatalogCache.set(server, {
					value: mapped,
					expiresAt: fetchedAt + CATALOG_TTL_MS,
				});

				return mapped;
			})
			.finally(() => {
				this.schemaCatalogLoads.delete(server);
			});

		this.schemaCatalogLoads.set(server, load);
		return load;
	}
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
