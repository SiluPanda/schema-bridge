import type { JSONSchema, ConvertOptions, ProviderSchema, TransformationRecord } from '../types';
import { deepClone } from '../normalizer';

/**
 * Convert a JSON Schema to MCP format.
 * MCP supports full JSON Schema with minimal restrictions.
 * Only $comment is removed per spec (actually MCP keeps everything; we keep it too).
 */
export function convertToMCP(schema: JSONSchema, options?: ConvertOptions): ProviderSchema {
  const transformations: TransformationRecord[] = [];
  const warnings: string[] = [];
  const result = deepClone(schema);

  // MCP supports full JSON Schema — no keywords removed
  // Per the spec keyword table, MCP keeps everything including $comment

  return { schema: result, transformations, warnings };
}
