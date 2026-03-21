import type {
  JSONSchema,
  Provider,
  ConvertOptions,
  ProviderSchema,
  ToolDefinitionInput,
  ToolDefinition,
  TransformationRecord,
} from './types';
import { normalize, resolveRefs } from './normalizer';
import { getConverter, supportedProviders } from './providers';
import { createTool, createTools } from './tool';

/**
 * Convert a JSON Schema to a provider-specific structured output format.
 *
 * @param schema - A JSON Schema object
 * @param provider - Target provider name
 * @param options - Conversion options
 * @returns The converted schema with transformation records and warnings
 */
export function convert(
  schema: JSONSchema,
  provider: Provider,
  options?: ConvertOptions,
): ProviderSchema {
  const converter = getConverter(provider);

  // Normalize the schema
  let normalized = normalize(schema);

  // Resolve $ref references
  const preserveRefs = provider === 'openai' || provider === 'anthropic' || provider === 'mcp' || provider === 'gemini';
  const { schema: resolved, transformations: refTransforms } = resolveRefs(normalized, {
    maxRecursionDepth: options?.maxRecursionDepth,
    preserveRefs,
  });

  // Apply provider-specific conversion
  const result = converter(resolved, options);

  // Merge ref transformations
  result.transformations = [...refTransforms, ...result.transformations];

  return result;
}

/**
 * Convert a tool definition to a provider-specific format.
 *
 * @param tool - Tool definition with name, description, and schema
 * @param provider - Target provider name
 * @param options - Conversion options
 * @returns Provider-specific tool definition with transformation records
 */
export function convertTool(
  tool: ToolDefinitionInput,
  provider: Provider,
  options?: ConvertOptions,
): { tool: ToolDefinition; transformations: TransformationRecord[]; warnings: string[] } {
  return createTool(tool, provider, options);
}

/**
 * Convert multiple tool definitions to a provider-specific format.
 *
 * @param tools - Array of tool definitions
 * @param provider - Target provider name
 * @param options - Conversion options
 * @returns Provider-specific tool definitions with transformation records
 */
export function convertTools(
  tools: ToolDefinitionInput[],
  provider: Provider,
  options?: ConvertOptions,
): { tools: ToolDefinition[]; transformations: TransformationRecord[][]; warnings: string[][] } {
  return createTools(tools, provider, options);
}

/**
 * List all supported provider names.
 */
export function supported(): Provider[] {
  return supportedProviders();
}

// Re-export types
export type {
  JSONSchema,
  Provider,
  ConvertOptions,
  ProviderSchema,
  ToolDefinitionInput,
  ToolDefinition,
  OpenAIToolDefinition,
  AnthropicToolDefinition,
  GeminiToolDefinition,
  CohereToolDefinition,
  MCPToolDefinition,
  OllamaToolDefinition,
  GenericToolDefinition,
  TransformationRecord,
  TransformationType,
} from './types';

// Re-export normalizer
export { normalize, resolveRefs } from './normalizer';

// Re-export provider-specific converters for advanced use
export {
  convertToOpenAI,
  wrapOpenAIResponseFormat,
  convertToAnthropic,
  convertToGemini,
  wrapGeminiResponseFormat,
  convertToCohere,
  convertToMCP,
  convertToOllama,
} from './providers';

// Re-export tool builders
export { createTool, createTools } from './tool';
