/**
 * Supported LLM provider names.
 */
export type Provider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'cohere'
  | 'mcp'
  | 'vercel-ai'
  | 'ollama';

/**
 * Recursive JSON Schema type supporting draft-07 and draft-2020-12 keywords.
 */
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema | JSONSchema[];
  prefixItems?: JSONSchema[];
  additionalProperties?: boolean | JSONSchema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  allOf?: JSONSchema[];
  not?: JSONSchema;
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
  definitions?: Record<string, JSONSchema>;
  $schema?: string;
  $comment?: string;
  title?: string;
  description?: string;
  default?: unknown;
  examples?: unknown[];
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  nullable?: boolean;
  [key: string]: unknown;
}

/**
 * Options for the convert function.
 */
export interface ConvertOptions {
  /** Schema name (used in OpenAI response_format envelope). */
  name?: string;
  /** Schema description. */
  description?: string;
  /** Enable strict mode for providers that support it (default: true for OpenAI). */
  strict?: boolean;
  /** Append removed constraints to description fields. */
  promoteConstraintsToDescription?: boolean;
  /** Maximum recursion depth for inlining recursive $ref (default: 5). */
  maxRecursionDepth?: number;
}

/**
 * Result of converting a schema for a provider.
 */
export interface ProviderSchema {
  /** The transformed schema in the provider's expected format. */
  schema: JSONSchema;
  /** Transformations applied during conversion. */
  transformations: TransformationRecord[];
  /** Warnings about lossy conversions. */
  warnings: string[];
}

/**
 * A record of a single transformation applied during conversion.
 */
export interface TransformationRecord {
  /** Type of transformation. */
  type: TransformationType;
  /** JSON path where the transformation was applied. */
  path: string;
  /** Human-readable description. */
  message: string;
  /** Whether the transformation is lossy. */
  lossy: boolean;
}

/**
 * Types of transformations that can be applied.
 */
export type TransformationType =
  | 'REF_INLINED'
  | 'ADDITIONAL_PROPERTIES_INJECTED'
  | 'REQUIRED_EXPANDED'
  | 'FIELD_MADE_NULLABLE'
  | 'KEYWORD_REMOVED'
  | 'COMPOSITION_SIMPLIFIED'
  | 'DEFAULT_REMOVED'
  | 'RECURSIVE_SCHEMA_TRUNCATED';

/**
 * Tool definition input (provider-agnostic).
 */
export interface ToolDefinitionInput {
  name: string;
  description: string;
  schema: JSONSchema;
  outputSchema?: JSONSchema;
}

/**
 * Provider-specific tool definition output.
 */
export type ToolDefinition =
  | OpenAIToolDefinition
  | AnthropicToolDefinition
  | GeminiToolDefinition
  | CohereToolDefinition
  | MCPToolDefinition
  | OllamaToolDefinition
  | GenericToolDefinition;

export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
    strict?: boolean;
  };
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: JSONSchema;
}

export interface GeminiToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface CohereToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
}

export interface OllamaToolDefinition {
  name: string;
  description: string;
  format: JSONSchema;
}

export interface GenericToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}
