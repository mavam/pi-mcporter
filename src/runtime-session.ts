import { createRuntime, type Runtime } from "mcporter";

class StaleRuntimeSessionError extends Error {
  constructor() {
    super("Stale runtime session.");
  }
}

export type RuntimeSessionOptions = {
  createRuntimeFn?: typeof createRuntime;
  onRuntimeInvalidated?: () => void;
  packageVersion: string;
};

export class RuntimeSession {
  private readonly createRuntimeFn: typeof createRuntime;
  private readonly onRuntimeInvalidated: () => void;
  private readonly packageVersion: string;

  private generation = 0;
  private runtime: Runtime | undefined;
  private runtimeKey: string | undefined;
  private shutdownEpoch = 0;
  private transitionQueue: Promise<void> = Promise.resolve();

  constructor(options: RuntimeSessionOptions) {
    this.createRuntimeFn = options.createRuntimeFn ?? createRuntime;
    this.onRuntimeInvalidated = options.onRuntimeInvalidated ?? (() => {});
    this.packageVersion = options.packageVersion;
  }

  async getRuntime(rootDir?: string): Promise<Runtime> {
    const key = normalizeRuntimeKey(rootDir);
    const requestShutdownEpoch = this.shutdownEpoch;
    return await this.enqueueTransition(async () => {
      if (requestShutdownEpoch !== this.shutdownEpoch) {
        throw new StaleRuntimeSessionError();
      }
      if (this.runtime && this.runtimeKey === key) {
        return this.runtime;
      }

      const activeRuntime = this.runtime;
      if (activeRuntime) {
        this.invalidateRuntime();
        await activeRuntime.close().catch(() => {});
        if (requestShutdownEpoch !== this.shutdownEpoch) {
          throw new StaleRuntimeSessionError();
        }
      }

      const generation = this.generation;
      const created = await this.createRuntimeFn({
        ...(rootDir ? { rootDir } : {}),
        clientInfo: {
          name: "pi-mcporter",
          version: this.packageVersion,
        },
      });
      if (generation !== this.generation) {
        await created.close().catch(() => {});
        throw new StaleRuntimeSessionError();
      }
      this.runtime = created;
      this.runtimeKey = key;
      return created;
    });
  }

  peekRuntime(rootDir?: string): Runtime | undefined {
    return this.runtimeKey === normalizeRuntimeKey(rootDir)
      ? this.runtime
      : undefined;
  }

  async shutdown(): Promise<void> {
    this.shutdownEpoch += 1;
    const activeRuntime = this.runtime;
    this.invalidateRuntime();
    if (activeRuntime) {
      await activeRuntime.close().catch(() => {});
    }
  }

  private invalidateRuntime(): void {
    this.generation += 1;
    this.runtime = undefined;
    this.runtimeKey = undefined;
    this.onRuntimeInvalidated();
  }

  private enqueueTransition<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transitionQueue.then(operation, operation);
    this.transitionQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function normalizeRuntimeKey(rootDir: string | undefined): string {
  return rootDir?.trim() ?? "";
}
