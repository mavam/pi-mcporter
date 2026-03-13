import { buildCatalogSystemPromptAppend } from "./system-prompt.js";
import type { CatalogService } from "./catalog-service.js";
import type { RuntimeSession } from "./runtime-session.js";

export class PromptCatalogProvider {
  constructor(
    private readonly runtimeSession: RuntimeSession,
    private readonly catalogService: CatalogService,
  ) {}

  async buildSystemPromptAppend(): Promise<string | undefined> {
    const runtime = await this.runtimeSession.getRuntime();
    const tools = await this.catalogService.ensurePromptCatalog(runtime);
    return buildCatalogSystemPromptAppend(tools);
  }
}
