import type { CatalogTool } from "./types.js";

export function rankTools(tools: CatalogTool[], query: string): CatalogTool[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [...tools];
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
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

  for (const token of tokens) {
    if (selector.includes(token)) {
      score += 45;
      continue;
    }
    if (description.includes(token)) {
      score += 20;
      continue;
    }
    const distance = levenshtein(token, toolName);
    if (distance <= 2) {
      score += 8 - distance * 2;
      continue;
    }
    return 0;
  }

  return score;
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
