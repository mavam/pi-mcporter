type PromptMetadata = {
  promptGuidelines?: string[];
  promptSnippet?: string;
};

export function withPromptMetadata<TToolDefinition extends object>(
  toolDefinition: TToolDefinition,
  promptMetadata: PromptMetadata,
): TToolDefinition {
  return {
    ...toolDefinition,
    ...promptMetadata,
  } as TToolDefinition;
}
