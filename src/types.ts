import type { TruncationResult } from "@mariozechner/pi-coding-agent";

export type McporterCallOutputMode = "full" | "summary" | "off";
export type McporterCallOutputKind = "text" | "structured" | "json" | "raw";

export interface CatalogTool {
	server: string;
	tool: string;
	selector: string;
	description?: string;
	inputSchema?: unknown;
	outputSchema?: unknown;
}

export interface CatalogSnapshot {
	fetchedAt: number;
	servers: string[];
	tools: CatalogTool[];
	byServer: Map<string, CatalogTool[]>;
	warnings: string[];
}

export interface Cached<T> {
	expiresAt: number;
	value: T;
}

export interface ToolDetails {
	action: "search" | "describe" | "call";
	selector?: string;
	resultCount?: number;
	cacheAgeMs?: number;
	timeoutMs?: number;
	warnings?: string[];
	truncation?: TruncationResult;
	fullOutputPath?: string;
	callOutputKind?: McporterCallOutputKind;
	callOutputSummary?: string;
}

export interface ParsedSelector {
	raw: string;
	server: string;
	tool: string;
}

export interface OutputShape {
	text: string;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}
