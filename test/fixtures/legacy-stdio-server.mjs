// A minimal stdio MCP server that behaves like a legacy implementation:
// MCPorter's `server/discover` negotiation probe makes it write to stderr and
// exit non-zero, which is the failure that used to dump raw stderr on stdout.
// The legacy retry spawns a fresh process that completes a normal handshake.
import { createInterface } from "node:readline";

const LEGACY_PROTOCOL_VERSION = "2025-06-18";

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

process.stderr.write("legacy-stdio-server: started\n");

createInterface({ input: process.stdin }).on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }

  const { id, method, params } = message;

  if (method === "server/discover") {
    process.stderr.write(
      "legacy-stdio-server: unsupported request server/discover\n",
    );
    process.exit(1);
  }

  if (id === undefined) {
    return;
  }

  switch (method) {
    case "initialize":
      respond(id, {
        protocolVersion:
          typeof params?.protocolVersion === "string"
            ? params.protocolVersion
            : LEGACY_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "legacy-stdio-server", version: "0.0.0" },
      });
      return;
    case "ping":
      respond(id, {});
      return;
    case "tools/list":
      respond(id, {
        tools: [
          {
            name: "echo",
            description: "Echo a message back.",
            inputSchema: {
              type: "object",
              properties: { message: { type: "string" } },
              required: ["message"],
              additionalProperties: false,
            },
          },
        ],
      });
      return;
    default:
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
  }
});
