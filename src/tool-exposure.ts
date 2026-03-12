import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { McporterMode } from "./mode.js";
import type { ResolvedMcporterConfig } from "./settings.js";

export interface EffectiveResolvedMcporterConfig
  extends ResolvedMcporterConfig {
  exposureWarnings: string[];
}

interface ToolExposureCapability {
  supportsSessionScopedTools: boolean;
}

interface ToolExposureManager {
  releaseSessionTools(): void;
  resolveEffectiveConfig(
    config: ResolvedMcporterConfig,
  ): EffectiveResolvedMcporterConfig;
}

export function createToolExposureManager(
  _pi: ExtensionAPI,
): ToolExposureManager {
  const capability = detectToolExposureCapability();

  return {
    releaseSessionTools() {
      // Current Pi releases do not expose session-scoped custom tool cleanup.
    },
    resolveEffectiveConfig(config) {
      if (capability.supportsSessionScopedTools) {
        return {
          ...config,
          exposureWarnings: [],
        };
      }

      const defaultMode = downgradeRequestedMode(config.mode);
      const serverModes = Object.fromEntries(
        Object.entries(config.serverModes).map(([server, mode]) => [
          server,
          downgradeRequestedMode(mode),
        ]),
      );

      const directOverrideServers = Object.entries(config.serverModes)
        .filter(([, mode]) => mode === "direct")
        .map(([server]) => server)
        .sort((a, b) => a.localeCompare(b));

      const exposureWarnings: string[] = [];
      if (config.mode === "direct") {
        exposureWarnings.push(
          "direct MCP tool exposure requires session-scoped tool registration; using preload mode instead.",
        );
      } else if (directOverrideServers.length > 0) {
        const servers = directOverrideServers.join(", ");
        exposureWarnings.push(
          `direct MCP tool exposure requires session-scoped tool registration; using preload mode for ${servers} instead.`,
        );
      }

      return {
        ...config,
        mode: defaultMode,
        serverModes,
        exposureWarnings,
      };
    },
  };
}

function detectToolExposureCapability(): ToolExposureCapability {
  return {
    supportsSessionScopedTools: false,
  };
}

function downgradeRequestedMode(mode: McporterMode): McporterMode {
  return mode === "direct" ? "preload" : mode;
}
