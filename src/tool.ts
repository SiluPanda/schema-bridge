import type {
  JSONSchema,
  Provider,
  ConvertOptions,
  ToolDefinitionInput,
  ToolDefinition,
  OpenAIToolDefinition,
  AnthropicToolDefinition,
  GeminiToolDefinition,
  CohereToolDefinition,
  MCPToolDefinition,
  OllamaToolDefinition,
  ProviderSchema,
  TransformationRecord,
} from './types';
import { getConverter } from './providers';
import { normalize, resolveRefs } from './normalizer';

/**
 * Create a provider-specific tool definition from a generic tool definition.
 */
export function createTool(
  tool: ToolDefinitionInput,
  provider: Provider,
  options?: ConvertOptions,
): { tool: ToolDefinition; transformations: TransformationRecord[]; warnings: string[] } {
  // Validate tool name
  if (!/^[a-zA-Z0-9_-]+$/.test(tool.name)) {
    throw new TypeError(
      `Invalid tool name "${tool.name}": must contain only alphanumeric characters, underscores, and hyphens`,
    );
  }

  const converter = getConverter(provider);

  // Normalize and resolve refs first for providers that need inlining
  let inputSchema = normalize(tool.schema);
  const allTransformations: TransformationRecord[] = [];
  const allWarnings: string[] = [];

  // For providers with limited $ref support, inline refs
  const preserveRefs = provider === 'openai' || provider === 'anthropic' || provider === 'mcp' || provider === 'gemini';
  const { schema: resolvedSchema, transformations: refTransforms } = resolveRefs(inputSchema, {
    maxRecursionDepth: options?.maxRecursionDepth,
    preserveRefs,
  });
  inputSchema = resolvedSchema;
  allTransformations.push(...refTransforms);

  // Apply provider-specific conversion
  const { schema: convertedSchema, transformations, warnings } = converter(inputSchema, options);
  allTransformations.push(...transformations);
  allWarnings.push(...warnings);

  // Build provider-specific tool envelope
  const toolDef = buildToolEnvelope(tool, convertedSchema, provider, options);

  // Handle output schema for MCP
  if (provider === 'mcp' && tool.outputSchema) {
    const outNormalized = normalize(tool.outputSchema);
    const { schema: outResolved } = resolveRefs(outNormalized, { preserveRefs: true });
    const { schema: outConverted } = converter(outResolved, options);
    (toolDef as MCPToolDefinition).outputSchema = outConverted;
  }

  return { tool: toolDef, transformations: allTransformations, warnings: allWarnings };
}

function buildToolEnvelope(
  tool: ToolDefinitionInput,
  schema: JSONSchema,
  provider: Provider,
  options?: ConvertOptions,
): ToolDefinition {
  const strict = options?.strict !== false;

  switch (provider) {
    case 'openai':
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: schema,
          strict,
        },
      } as OpenAIToolDefinition;

    case 'anthropic':
      return {
        name: tool.name,
        description: tool.description,
        input_schema: schema,
      } as AnthropicToolDefinition;

    case 'gemini':
      return {
        name: tool.name,
        description: tool.description,
        parameters: schema,
      } as GeminiToolDefinition;

    case 'cohere':
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: schema,
        },
      } as CohereToolDefinition;

    case 'mcp':
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: schema,
      } as MCPToolDefinition;

    case 'ollama':
      return {
        name: tool.name,
        description: tool.description,
        format: schema,
      } as OllamaToolDefinition;

    case 'vercel-ai':
      return {
        name: tool.name,
        description: tool.description,
        parameters: schema,
      };

    default:
      throw new Error(`Unsupported provider for tool definition: "${provider}"`);
  }
}

/**
 * Create tool definitions for multiple tools for a specific provider.
 * For Gemini, wraps all tools in a single functionDeclarations object.
 */
export function createTools(
  tools: ToolDefinitionInput[],
  provider: Provider,
  options?: ConvertOptions,
): { tools: ToolDefinition[]; transformations: TransformationRecord[][]; warnings: string[][] } {
  const results = tools.map(tool => createTool(tool, provider, options));

  if (provider === 'gemini') {
    // Wrap in functionDeclarations array
    const declarations = results.map(r => r.tool as GeminiToolDefinition);
    return {
      tools: [{ functionDeclarations: declarations } as unknown as ToolDefinition],
      transformations: results.map(r => r.transformations),
      warnings: results.map(r => r.warnings),
    };
  }

  return {
    tools: results.map(r => r.tool),
    transformations: results.map(r => r.transformations),
    warnings: results.map(r => r.warnings),
  };
}
