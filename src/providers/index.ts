import type { JSONSchema, Provider, ConvertOptions, ProviderSchema } from '../types';
import { convertToOpenAI } from './openai';
import { convertToAnthropic } from './anthropic';
import { convertToGemini } from './gemini';
import { convertToCohere } from './cohere';
import { convertToMCP } from './mcp';
import { convertToOllama } from './ollama';

export type ProviderConverter = (schema: JSONSchema, options?: ConvertOptions) => ProviderSchema;

const converters: Record<string, ProviderConverter> = {
  openai: convertToOpenAI,
  anthropic: convertToAnthropic,
  gemini: convertToGemini,
  cohere: convertToCohere,
  mcp: convertToMCP,
  'vercel-ai': convertToMCP, // Vercel AI uses standard JSON Schema like MCP
  ollama: convertToOllama,
};

/**
 * Get the converter function for a provider.
 */
export function getConverter(provider: Provider): ProviderConverter {
  const converter = converters[provider];
  if (!converter) {
    throw new Error(`Unsupported provider: "${provider}". Supported providers: ${Object.keys(converters).join(', ')}`);
  }
  return converter;
}

/**
 * List all supported provider names.
 */
export function supportedProviders(): Provider[] {
  return Object.keys(converters) as Provider[];
}

export { convertToOpenAI, wrapOpenAIResponseFormat } from './openai';
export { convertToAnthropic } from './anthropic';
export { convertToGemini, wrapGeminiResponseFormat } from './gemini';
export { convertToCohere } from './cohere';
export { convertToMCP } from './mcp';
export { convertToOllama } from './ollama';
