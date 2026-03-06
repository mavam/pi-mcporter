import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	DEFAULT_CALL_OUTPUT_MODE,
	MCPORTER_CONFIG_FILE_NAME,
} from "./constants.js";
import { isPlainObject, toErrorMessage } from "./helpers.js";
import type { McporterCallOutputMode } from "./types.js";

export interface McporterConfigFile {
	callOutputMode?: McporterCallOutputMode;
}

export interface LoadedMcporterConfig {
	path: string;
	config: McporterConfigFile;
	effectiveCallOutputMode: McporterCallOutputMode;
	warnings: string[];
}

export function isMcporterCallOutputMode(
	value: unknown,
): value is McporterCallOutputMode {
	return value === "full" || value === "summary" || value === "off";
}

export function resolveMcporterCallOutputMode(
	mode?: McporterCallOutputMode,
): McporterCallOutputMode {
	return mode ?? DEFAULT_CALL_OUTPUT_MODE;
}

export function getMcporterConfigPath(homeDir = homedir()): string {
	return join(homeDir, ".pi", "agent", MCPORTER_CONFIG_FILE_NAME);
}

export async function loadMcporterConfig(options?: {
	homeDir?: string;
}): Promise<LoadedMcporterConfig> {
	const path = getMcporterConfigPath(options?.homeDir);
	const state = await readConfigFile(path);
	return {
		path,
		config: state.config,
		effectiveCallOutputMode: resolveMcporterCallOutputMode(
			state.config.callOutputMode,
		),
		warnings:
			typeof state.warning === "string" && state.warning.length > 0
				? [state.warning]
				: [],
	};
}

export async function writeMcporterCallOutputMode(
	nextMode: McporterCallOutputMode,
	options?: { homeDir?: string },
): Promise<LoadedMcporterConfig> {
	const path = getMcporterConfigPath(options?.homeDir);
	const rawObject = await readConfigFileForWrite(path);
	rawObject.callOutputMode = nextMode;

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(rawObject, null, 2)}\n`, "utf8");

	return loadMcporterConfig(options);
}

async function readConfigFile(path: string): Promise<{
	config: McporterConfigFile;
	warning?: string;
}> {
	let content: string;
	try {
		content = await readFile(path, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) {
			return { config: {} };
		}
		return {
			config: {},
			warning: `Ignoring unreadable mcporter config at ${path}: ${toErrorMessage(
				error,
			)}`,
		};
	}

	let decoded: unknown;
	try {
		decoded = JSON.parse(content);
	} catch (error) {
		return {
			config: {},
			warning: `Ignoring invalid mcporter config at ${path}: ${toErrorMessage(
				error,
			)}`,
		};
	}

	if (!isPlainObject(decoded)) {
		return {
			config: {},
			warning: `Ignoring invalid mcporter config at ${path}: expected a JSON object.`,
		};
	}

	const modeValue = decoded.callOutputMode;
	if (modeValue === undefined || isMcporterCallOutputMode(modeValue)) {
		return {
			config: {
				...(modeValue ? { callOutputMode: modeValue } : {}),
			},
		};
	}

	return {
		config: {},
		warning: `Ignoring invalid callOutputMode in ${path}: expected one of full, summary, off.`,
	};
}

async function readConfigFileForWrite(
	path: string,
): Promise<Record<string, unknown>> {
	let content: string;
	try {
		content = await readFile(path, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) {
			return {};
		}
		throw new Error(
			`Cannot update mcporter config at ${path}: ${toErrorMessage(error)}`,
		);
	}

	let decoded: unknown;
	try {
		decoded = JSON.parse(content);
	} catch (error) {
		throw new Error(
			`Cannot update mcporter config at ${path}: ${toErrorMessage(error)}`,
		);
	}

	if (!isPlainObject(decoded)) {
		throw new Error(
			`Cannot update mcporter config at ${path}: expected a JSON object.`,
		);
	}

	return { ...decoded };
}

function isMissingFileError(error: unknown): boolean {
	return (
		error !== null &&
		typeof error === "object" &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}
