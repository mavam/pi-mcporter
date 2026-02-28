import { describeConnectionIssue } from "mcporter";
import { toErrorMessage } from "./helpers.js";

export function shouldInvalidateCatalogOnCallError(error: unknown): boolean {
	const issue = describeConnectionIssue(error);
	switch (issue.kind) {
		case "auth":
		case "offline":
		case "http":
		case "stdio-exit":
			return true;
		default:
			break;
	}

	const message = toErrorMessage(error).toLowerCase();
	if (
		message.includes("unknown") &&
		(message.includes("tool") || message.includes("server"))
	) {
		return true;
	}

	return false;
}

export function connectionHints(
	issue: ReturnType<typeof describeConnectionIssue>,
	server: string,
): string[] {
	switch (issue.kind) {
		case "auth":
			return [
				`Hint: '${server}' likely needs authentication.`,
				`Run: mcporter auth ${server}`,
			];
		case "offline":
			return [
				"Hint: MCP server appears offline or unreachable. Check network/server process and retry.",
			];
		case "http":
			return [
				`Hint: HTTP error${issue.statusCode ? ` ${issue.statusCode}` : ""}. Check endpoint URL, auth, and server status.`,
			];
		case "stdio-exit": {
			const code =
				issue.stdioExitCode !== undefined
					? `code ${issue.stdioExitCode}`
					: undefined;
			const signal = issue.stdioSignal
				? `signal ${issue.stdioSignal}`
				: undefined;
			const detail = [code, signal].filter(Boolean).join(", ");
			return [
				`Hint: stdio MCP process exited${detail ? ` (${detail})` : ""}. Check command path and environment variables.`,
			];
		}
		default:
			return ["Hint: check MCPorter config, connectivity, and server logs."];
	}
}
