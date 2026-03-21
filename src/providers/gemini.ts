import type { JSONSchema, ConvertOptions, ProviderSchema, TransformationRecord } from '../types';
import { deepClone } from '../normalizer';

/**
 * Keywords that Gemini does not support.
 */
const UNSUPPORTED_KEYWORDS = ['default', 'examples', '$comment'];

/**
 * Convert a JSON Schema to Google Gemini's format.
 */
export function convertToGemini(schema: JSONSchema, options?: ConvertOptions): ProviderSchema {
  const transformations: TransformationRecord[] = [];
  const warnings: string[] = [];
  let result = deepClone(schema);

  // Remove unsupported keywords
  result = removeKeywords(result, '$', transformations, warnings, options);

  // Simplify composition (limited oneOf/allOf support)
  result = simplifyComposition(result, '$', transformations, warnings);

  return { schema: result, transformations, warnings };
}

/**
 * Wrap a converted schema in Gemini's response format envelope.
 */
export function wrapGeminiResponseFormat(schema: JSONSchema): Record<string, unknown> {
  return {
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };
}

function removeKeywords(
  node: JSONSchema,
  path: string,
  transformations: TransformationRecord[],
  warnings: string[],
  options?: ConvertOptions,
): JSONSchema {
  const result = { ...node };
  const promote = options?.promoteConstraintsToDescription ?? false;

  for (const keyword of UNSUPPORTED_KEYWORDS) {
    if (keyword in result) {
      const value = result[keyword];

      if (promote && keyword !== '$comment' && keyword !== 'examples') {
        const constraint = `${keyword}: ${JSON.stringify(value)}`;
        result.description = result.description
          ? `${result.description} (${constraint})`
          : `(${constraint})`;
      }

      delete result[keyword];
      transformations.push({
        type: 'KEYWORD_REMOVED',
        path,
        message: `Removed unsupported keyword "${keyword}"`,
        lossy: keyword !== '$comment',
      });
      if (keyword !== '$comment') {
        warnings.push(`Removed "${keyword}" at ${path} — Gemini does not support this keyword`);
      }
    }
  }

  if (result.properties) {
    const newProps: Record<string, JSONSchema> = {};
    for (const [key, prop] of Object.entries(result.properties)) {
      newProps[key] = removeKeywords(prop, `${path}.properties.${key}`, transformations, warnings, options);
    }
    result.properties = newProps;
  }

  if (result.items && !Array.isArray(result.items)) {
    result.items = removeKeywords(result.items as JSONSchema, `${path}.items`, transformations, warnings, options);
  }

  if (result.anyOf) {
    result.anyOf = result.anyOf.map((s, i) =>
      removeKeywords(s, `${path}.anyOf[${i}]`, transformations, warnings, options),
    );
  }

  if (result.oneOf) {
    result.oneOf = result.oneOf.map((s, i) =>
      removeKeywords(s, `${path}.oneOf[${i}]`, transformations, warnings, options),
    );
  }

  if (result.allOf) {
    result.allOf = result.allOf.map((s, i) =>
      removeKeywords(s, `${path}.allOf[${i}]`, transformations, warnings, options),
    );
  }

  if (result.$defs) {
    const newDefs: Record<string, JSONSchema> = {};
    for (const [key, def] of Object.entries(result.$defs)) {
      newDefs[key] = removeKeywords(def, `${path}.$defs.${key}`, transformations, warnings, options);
    }
    result.$defs = newDefs;
  }

  return result;
}

function simplifyComposition(
  node: JSONSchema,
  path: string,
  transformations: TransformationRecord[],
  warnings: string[],
): JSONSchema {
  let result = { ...node };

  // Merge allOf
  if (result.allOf && result.allOf.length > 0) {
    let merged: JSONSchema = {};
    for (const sub of result.allOf) {
      merged = mergeSchemas(merged, sub);
    }
    const { allOf: _, ...rest } = result;
    result = { ...rest, ...merged };
    transformations.push({
      type: 'COMPOSITION_SIMPLIFIED',
      path,
      message: 'Merged allOf schemas',
      lossy: false,
    });
  }

  // Remove not
  if (result.not) {
    delete result.not;
    transformations.push({
      type: 'COMPOSITION_SIMPLIFIED',
      path,
      message: 'Removed "not" keyword',
      lossy: true,
    });
    warnings.push(`Removed "not" at ${path} — Gemini has limited "not" support`);
  }

  // Recurse
  if (result.properties) {
    const newProps: Record<string, JSONSchema> = {};
    for (const [key, prop] of Object.entries(result.properties)) {
      newProps[key] = simplifyComposition(prop, `${path}.properties.${key}`, transformations, warnings);
    }
    result.properties = newProps;
  }

  if (result.items && !Array.isArray(result.items)) {
    result.items = simplifyComposition(result.items as JSONSchema, `${path}.items`, transformations, warnings);
  }

  if (result.anyOf) {
    result.anyOf = result.anyOf.map((s, i) =>
      simplifyComposition(s, `${path}.anyOf[${i}]`, transformations, warnings),
    );
  }

  if (result.oneOf) {
    result.oneOf = result.oneOf.map((s, i) =>
      simplifyComposition(s, `${path}.oneOf[${i}]`, transformations, warnings),
    );
  }

  if (result.$defs) {
    const newDefs: Record<string, JSONSchema> = {};
    for (const [key, def] of Object.entries(result.$defs)) {
      newDefs[key] = simplifyComposition(def, `${path}.$defs.${key}`, transformations, warnings);
    }
    result.$defs = newDefs;
  }

  return result;
}

function mergeSchemas(a: JSONSchema, b: JSONSchema): JSONSchema {
  const result = { ...a };
  if (b.type) result.type = b.type;
  if (b.description) result.description = b.description;
  if (b.properties) {
    result.properties = { ...(result.properties || {}), ...b.properties };
  }
  if (b.required) {
    const reqSet = new Set([...(result.required || []), ...b.required]);
    result.required = Array.from(reqSet);
  }
  for (const key of Object.keys(b)) {
    if (!(key in result)) {
      (result as Record<string, unknown>)[key] = (b as Record<string, unknown>)[key];
    }
  }
  return result;
}
