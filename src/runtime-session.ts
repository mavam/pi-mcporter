import { createRuntime, type Runtime } from "mcporter";

class StaleRuntimeSessionError extends Error {
  constructor() {
    super("Stale runtime session.");
  }
}

export type RuntimeSessionOptions = {
  createRuntimeFn?: typeof createRuntime;
  packageVersion: string;
};

export class RuntimeSession {
  private readonly createRuntimeFn: typeof createRuntime;
  private readonly packageVersion: string;

  private generation = 0;
  private runtime: Runtime | undefined;
  private runtimeKey: string | undefined;
  private runtimePromise: Promise<Runtime> | undefined;
  private runtimePromiseKey: string | undefined;

  constructor(options: RuntimeSessionOptions) {
    this.createRuntimeFn = options.createRuntimeFn ?? createRuntime;
    this.packageVersion = options.packageVersion;
  }

  async getRuntime(rootDir?: string): Promise<Runtime> {
    const key = normalizeRuntimeKey(rootDir);
    if (this.runtime && this.runtimeKey === key) {
      return this.runtime;
    }

    if (
      this.runtime ||
      (this.runtimePromise && this.runtimePromiseKey !== key)
    ) {
      await this.shutdown();
    }

    if (!this.runtimePromise) {
      const generation = this.generation;
      let promise: Promise<Runtime>;
      promise = this.createRuntimeFn({
        ...(rootDir ? { rootDir } : {}),
        clientInfo: {
          name: "pi-mcporter",
          version: this.packageVersion,
        },
      })
        .then(async (created) => {
          if (generation !== this.generation) {
            await created.close().catch(() => {});
            throw new StaleRuntimeSessionError();
          }
          this.runtime = created;
          this.runtimeKey = key;
          return created;
        })
        .catch((error) => {
          if (this.runtimePromise === promise) {
            this.runtimePromise = undefined;
            this.runtimePromiseKey = undefined;
          }
          throw error;
        });
      this.runtimePromise = promise;
      this.runtimePromiseKey = key;
    }

    return await this.runtimePromise;
  }

  async shutdown(): Promise<void> {
    this.generation += 1;
    const activeRuntime = this.runtime;
    this.runtime = undefined;
    this.runtimeKey = undefined;
    this.runtimePromise = undefined;
    this.runtimePromiseKey = undefined;

    if (activeRuntime) {
      await activeRuntime.close().catch(() => {});
    }
  }
}

function normalizeRuntimeKey(rootDir: string | undefined): string {
  return rootDir?.trim() ?? "";
}
