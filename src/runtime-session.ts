import { createRuntime, type Runtime } from "mcporter";
import { attachSecretEnvToRuntime } from "./secret-env.js";
import type { McporterServerSettings } from "./settings.js";

type RuntimeSessionServerSettings = Record<string, McporterServerSettings>;

class StaleRuntimeSessionError extends Error {
  constructor() {
    super("Stale runtime session.");
  }
}

export type RuntimeSessionOptions = {
  createRuntimeFn?: typeof createRuntime;
  getRuntimeConfigPath: () => Promise<string | undefined>;
  getRuntimeServerSettings?: () => Promise<
    RuntimeSessionServerSettings | undefined
  >;
  packageVersion: string;
};

export class RuntimeSession {
  private readonly createRuntimeFn: typeof createRuntime;
  private readonly getRuntimeConfigPath: () => Promise<string | undefined>;
  private readonly getRuntimeServerSettings: () => Promise<
    RuntimeSessionServerSettings | undefined
  >;
  private readonly packageVersion: string;

  private generation = 0;
  private runtime: Runtime | undefined;
  private runtimePromise: Promise<Runtime> | undefined;

  constructor(options: RuntimeSessionOptions) {
    this.createRuntimeFn = options.createRuntimeFn ?? createRuntime;
    this.getRuntimeConfigPath = options.getRuntimeConfigPath;
    this.getRuntimeServerSettings =
      options.getRuntimeServerSettings ?? (async () => undefined);
    this.packageVersion = options.packageVersion;
  }

  async getRuntime(): Promise<Runtime> {
    if (this.runtime) {
      return this.runtime;
    }

    if (!this.runtimePromise) {
      const generation = this.generation;
      let promise: Promise<Runtime>;
      promise = Promise.all([
        this.getRuntimeConfigPath(),
        this.getRuntimeServerSettings(),
      ])
        .then(async ([configPath, mcpServers]) => {
          this.throwIfStale(generation);
          const runtime = await this.createRuntimeFn({
            ...(configPath ? { configPath } : {}),
            clientInfo: {
              name: "pi-mcporter",
              version: this.packageVersion,
            },
          });
          attachSecretEnvToRuntime(runtime, mcpServers);
          return runtime;
        })
        .then(async (created) => {
          if (generation !== this.generation) {
            await created.close().catch(() => {});
            throw new StaleRuntimeSessionError();
          }
          this.runtime = created;
          return created;
        })
        .catch((error) => {
          if (this.runtimePromise === promise) {
            this.runtimePromise = undefined;
          }
          throw error;
        });
      this.runtimePromise = promise;
    }

    return await this.runtimePromise;
  }

  async shutdown(): Promise<void> {
    this.generation += 1;
    const activeRuntime = this.runtime;
    this.runtime = undefined;
    this.runtimePromise = undefined;

    if (activeRuntime) {
      await activeRuntime.close().catch(() => {});
    }
  }

  private throwIfStale(generation: number): void {
    if (generation !== this.generation) {
      throw new StaleRuntimeSessionError();
    }
  }
}
