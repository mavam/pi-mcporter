import { StringEnum } from "@mariozechner/pi-ai";
import { type Static, Type } from "typebox";
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_SEARCH_LIMIT,
  MAX_CALL_TIMEOUT_MS,
  MAX_SEARCH_LIMIT,
} from "./constants.js";

export const McporterParameters = Type.Object(
  {
    action: StringEnum(["search", "describe", "call"] as const, {
      description:
        "Action to run: search tools, describe a tool schema, or call a tool.",
    }),
    selector: Type.Optional(
      Type.String({
        description:
          "Tool selector in the form 'server.tool'. Required for describe and call.",
      }),
    ),
    query: Type.Optional(
      Type.String({ description: "Free-text query for search." }),
    ),
    args: Type.Optional(
      Type.Object(
        {},
        {
          additionalProperties: true,
          description: "Arguments object for call action.",
        },
      ),
    ),
    argsJson: Type.Optional(
      Type.String({
        description:
          "JSON object string for call arguments. Mutually exclusive with args.",
      }),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_SEARCH_LIMIT,
        description: `Maximum number of search matches (default ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}).`,
      }),
    ),
    timeoutMs: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_CALL_TIMEOUT_MS,
        description: `Per-call timeout in milliseconds (default ${DEFAULT_CALL_TIMEOUT_MS}).`,
      }),
    ),
  },
  { additionalProperties: false },
);

export type McporterParams = Static<typeof McporterParameters>;
