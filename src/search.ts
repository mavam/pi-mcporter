import type { CatalogTool } from "./types.js";

const SEARCH_WORD_SEPARATOR = /[^\p{L}\p{N}]+/u;

export function rankServers(servers: string[], query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [...servers].sort((a, b) => a.localeCompare(b));
  }

  const catalogTerms = catalogTokens(servers);
  const tokens = relevantSearchTokens(normalized, catalogTerms);
  return servers
    .map((server) => ({
      server,
      score: scoreServer(server, normalized, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.server.localeCompare(b.server))
    .map((entry) => entry.server);
}

export function rankTools(tools: CatalogTool[], query: string): CatalogTool[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [...tools];
  }

  const catalogTerms = catalogTokens(
    tools.flatMap((tool) => [tool.selector, tool.description ?? ""]),
  );
  const tokens = relevantSearchTokens(normalized, catalogTerms);
  return tools
    .map((tool) => ({ tool, score: scoreTool(tool, normalized, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.tool.selector.localeCompare(b.tool.selector);
    })
    .map((entry) => entry.tool);
}

export function scoreTool(
  tool: CatalogTool,
  normalizedQuery: string,
  tokens: string[],
): number {
  const selector = tool.selector.toLowerCase();
  const toolName = tool.tool.toLowerCase();
  const server = tool.server.toLowerCase();
  const description = (tool.description ?? "").toLowerCase();

  if (selector === normalizedQuery) return 1000;
  if (toolName === normalizedQuery) return 950;

  let score = 0;
  if (selector.startsWith(normalizedQuery)) score += 450;
  if (toolName.startsWith(normalizedQuery)) score += 400;
  if (server.startsWith(normalizedQuery)) score += 220;
  if (selector.includes(normalizedQuery)) score += 180;
  if (description.includes(normalizedQuery)) score += 80;

  const selectorTerms = catalogTokens([selector]);
  const descriptionTerms = catalogTokens([description]);
  let matchedTokens = 0;
  for (const token of tokens) {
    const selectorMatch = bestTokenMatch(token, selectorTerms);
    if (selectorMatch) {
      score += selectorMatch === "fuzzy" ? 6 : 45;
      matchedTokens += 1;
      continue;
    }
    const descriptionMatch = bestTokenMatch(token, descriptionTerms);
    if (descriptionMatch) {
      score += descriptionMatch === "fuzzy" ? 6 : 20;
      matchedTokens += 1;
    }
  }

  const requiredMatches = Math.max(1, Math.ceil(tokens.length * 0.6));
  return matchedTokens >= requiredMatches ? score : 0;
}

function scoreServer(
  server: string,
  normalizedQuery: string,
  tokens: string[],
): number {
  const normalizedServer = server.toLowerCase();
  if (normalizedServer === normalizedQuery) return 1000;
  if (tokens.length === 0) return 0;

  let score = 0;
  if (normalizedServer.startsWith(normalizedQuery)) score += 500;
  if (normalizedServer.includes(normalizedQuery)) score += 300;

  const serverTerms = catalogTokens([normalizedServer]);
  for (const token of tokens) {
    const match = bestTokenMatch(token, serverTerms);
    if (match === "exact") score += 250;
    else if (match === "prefix") score += 100;
    else if (match === "fuzzy") score += 20;
  }

  return score;
}

function relevantSearchTokens(
  query: string,
  catalogTerms: Set<string>,
): string[] {
  return searchTokens(query, catalogTerms).filter((token) =>
    bestTokenMatch(token, catalogTerms),
  );
}

function bestTokenMatch(
  token: string,
  catalogTerms: Set<string>,
): "exact" | "prefix" | "fuzzy" | undefined {
  if (catalogTerms.has(token)) return "exact";

  for (const term of catalogTerms) {
    if (token.length >= 4 && term.startsWith(token)) return "prefix";
  }
  if (token.length >= 5) {
    for (const term of catalogTerms) {
      if (levenshtein(token, term) <= 2) return "fuzzy";
    }
  }

  return undefined;
}

function catalogTokens(values: string[]): Set<string> {
  return new Set(
    values.flatMap((value) =>
      value.toLowerCase().split(SEARCH_WORD_SEPARATOR).filter(Boolean),
    ),
  );
}

function searchTokens(query: string, catalogTerms: Set<string>): string[] {
  return (
    query
      .split(SEARCH_WORD_SEPARATOR)
      .filter(Boolean)
      // Preserve exact catalog terms so proper nouns ending in "s", such as
      // Jenkins and Kubernetes, keep their exact-token ranking bonus.
      .map((token) =>
        catalogTerms.has(token) ? token : stemSearchToken(token),
      )
      .filter((token, index, tokens) => tokens.indexOf(token) === index)
  );
}

function stemSearchToken(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }
  if (token.length > 4 && token.endsWith("ed")) {
    return token.slice(0, -2);
  }
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

export function suggest(
  input: string,
  candidates: string[],
  max = 5,
): string[] {
  const normalizedInput = input.trim().toLowerCase();
  if (!normalizedInput || candidates.length === 0) {
    return [];
  }

  const ranked = candidates
    .map((candidate) => {
      const normalizedCandidate = candidate.toLowerCase();
      const distance = levenshtein(normalizedInput, normalizedCandidate);
      let score = distance;

      if (normalizedCandidate === normalizedInput) score -= 10;
      else if (normalizedCandidate.startsWith(normalizedInput)) score -= 4;
      else if (normalizedCandidate.includes(normalizedInput)) score -= 2;

      return { candidate, score };
    })
    .sort(
      (a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate),
    );

  const threshold = Math.max(3, Math.floor(normalizedInput.length * 0.45));
  return ranked
    .filter((item) => item.score <= threshold)
    .slice(0, max)
    .map((item) => item.candidate);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    previous[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    const aChar = a.charCodeAt(i - 1);

    for (let j = 1; j <= b.length; j++) {
      const cost = aChar === b.charCodeAt(j - 1) ? 0 : 1;
      const insert = current[j - 1] + 1;
      const remove = previous[j] + 1;
      const replace = previous[j - 1] + cost;
      current[j] = Math.min(insert, remove, replace);
    }

    for (let j = 0; j <= b.length; j++) {
      previous[j] = current[j];
    }
  }

  return previous[b.length] ?? Number.MAX_SAFE_INTEGER;
}
