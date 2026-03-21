import type { JSONSchema, ConvertOptions, ProviderSchema, TransformationRecord } from '../types';
import { deepClone } from '../normalizer';

/**
 * Keywords that Cohere does not support.
 */
const UNSUPPORTED_KEYWORDS = ['$comment'];

/**
 * Convert a JSON Schema to Cohere's format.
 * Cohere uses standard JSON Schema with minimal restrictions.
 * $ref is inlined for maximum compatibility (limited documentation on support).
 */
export function convertToCohere(schema: JSONSchema, options?: ConvertOptions): ProviderSchema {
  const transformations: TransformationRecord[] = [];
  const warnings: string[] = [];
  let result = deepClone(schema);

  // Remove unsupported keywords
  result = removeKeywords(result, '$', transformations);

  return { schema: result, transformations, warnings };
}

function removeKeywords(
  node: JSONSchema,
  path: string,
  transformations: TransformationRecord[],
): JSONSchema {
  const result = { ...node };

  for (const keyword of UNSUPPORTED_KEYWORDS) {
    if (keyword in result) {
      delete result[keyword];
      transformations.push({
        type: 'KEYWORD_REMOVED',
        path,
        message: `Removed unsupported keyword "${keyword}"`,
        lossy: false,
      });
    }
  }

  if (result.properties) {
    const newProps: Record<string, JSONSchema> = {};
    for (const [key, prop] of Object.entries(result.properties)) {
      newProps[key] = removeKeywords(prop, `${path}.properties.${key}`, transformations);
    }
    result.properties = newProps;
  }

  if (result.items && !Array.isArray(result.items)) {
    result.items = removeKeywords(result.items as JSONSchema, `${path}.items`, transformations);
  }

  if (result.anyOf) {
    result.anyOf = result.anyOf.map((s, i) =>
      removeKeywords(s, `${path}.anyOf[${i}]`, transformations),
    );
  }

  if (result.oneOf) {
    result.oneOf = result.oneOf.map((s, i) =>
      removeKeywords(s, `${path}.oneOf[${i}]`, transformations),
    );
  }

  if (result.allOf) {
    result.allOf = result.allOf.map((s, i) =>
      removeKeywords(s, `${path}.allOf[${i}]`, transformations),
    );
  }

  if (result.$defs) {
    const newDefs: Record<string, JSONSchema> = {};
    for (const [key, def] of Object.entries(result.$defs)) {
      newDefs[key] = removeKeywords(def, `${path}.$defs.${key}`, transformations);
    }
    result.$defs = newDefs;
  }

  return result;
}
