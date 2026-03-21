import type { JSONSchema, ConvertOptions, ProviderSchema, TransformationRecord } from '../types';
import { deepClone } from '../normalizer';

/**
 * Keywords that OpenAI strict mode does not support.
 */
const UNSUPPORTED_KEYWORDS = [
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems',
  'pattern', 'format', 'default', 'examples', '$comment',
];

/**
 * Convert a JSON Schema to OpenAI's structured output format.
 */
export function convertToOpenAI(schema: JSONSchema, options?: ConvertOptions): ProviderSchema {
  const strict = options?.strict !== false;
  const transformations: TransformationRecord[] = [];
  const warnings: string[] = [];
  let result = deepClone(schema);

  if (strict) {
    // Inject additionalProperties: false on all objects
    result = injectAdditionalProperties(result, '$', transformations);

    // Expand required to include all properties; make optional fields nullable
    result = expandRequired(result, '$', transformations);

    // Remove unsupported keywords
    result = removeUnsupportedKeywords(result, '$', transformations, warnings, options);

    // Simplify composition keywords
    result = simplifyComposition(result, '$', transformations, warnings);
  }

  return { schema: result, transformations, warnings };
}

/**
 * Wrap a converted schema in OpenAI's response_format envelope.
 */
export function wrapOpenAIResponseFormat(
  schema: JSONSchema,
  name: string,
  strict: boolean = true,
): Record<string, unknown> {
  return {
    type: 'json_schema',
    json_schema: {
      name,
      schema,
      strict,
    },
  };
}

function injectAdditionalProperties(
  node: JSONSchema,
  path: string,
  transformations: TransformationRecord[],
): JSONSchema {
  const result = { ...node };

  const isObject = result.type === 'object' || result.properties !== undefined;

  if (isObject) {
    if (result.additionalProperties === undefined || result.additionalProperties === true) {
      const prev = result.additionalProperties;
      result.additionalProperties = false;
      transformations.push({
        type: 'ADDITIONAL_PROPERTIES_INJECTED',
        path,
        message: `Set additionalProperties to false (was ${prev === undefined ? 'undefined' : 'true'})`,
        lossy: false,
      });
    } else if (typeof result.additionalProperties === 'object') {
      result.additionalProperties = false;
      transformations.push({
        type: 'ADDITIONAL_PROPERTIES_INJECTED',
        path,
        message: 'Replaced additionalProperties schema with false (lossy)',
        lossy: true,
      });
    }
  }

  if (result.properties) {
    const newProps: Record<string, JSONSchema> = {};
    for (const [key, prop] of Object.entries(result.properties)) {
      newProps[key] = injectAdditionalProperties(prop, `${path}.properties.${key}`, transformations);
    }
    result.properties = newProps;
  }

  if (result.items && !Array.isArray(result.items)) {
    result.items = injectAdditionalProperties(result.items as JSONSchema, `${path}.items`, transformations);
  }

  if (result.anyOf) {
    result.anyOf = result.anyOf.map((s, i) =>
      injectAdditionalProperties(s, `${path}.anyOf[${i}]`, transformations),
    );
  }

  if (result.oneOf) {
    result.oneOf = result.oneOf.map((s, i) =>
      injectAdditionalProperties(s, `${path}.oneOf[${i}]`, transformations),
    );
  }

  if (result.allOf) {
    result.allOf = result.allOf.map((s, i) =>
      injectAdditionalProperties(s, `${path}.allOf[${i}]`, transformations),
    );
  }

  if (result.$defs) {
    const newDefs: Record<string, JSONSchema> = {};
    for (const [key, def] of Object.entries(result.$defs)) {
      newDefs[key] = injectAdditionalProperties(def, `${path}.$defs.${key}`, transformations);
    }
    result.$defs = newDefs;
  }

  return result;
}

function expandRequired(
  node: JSONSchema,
  path: string,
  transformations: TransformationRecord[],
): JSONSchema {
  const result = { ...node };

  if (result.properties) {
    const required = new Set(result.required || []);
    const newProps: Record<string, JSONSchema> = {};

    for (const [key, prop] of Object.entries(result.properties)) {
      let processed = expandRequired(prop, `${path}.properties.${key}`, transformations);

      if (!required.has(key)) {
        required.add(key);
        processed = makeNullable(processed);
        transformations.push({
          type: 'REQUIRED_EXPANDED',
          path: `${path}.properties.${key}`,
          message: `Added "${key}" to required array and made nullable`,
          lossy: false,
        });
      }

      newProps[key] = processed;
    }

    result.properties = newProps;
    result.required = Array.from(required);
  }

  if (result.items && !Array.isArray(result.items)) {
    result.items = expandRequired(result.items as JSONSchema, `${path}.items`, transformations);
  }

  if (result.anyOf) {
    result.anyOf = result.anyOf.map((s, i) =>
      expandRequired(s, `${path}.anyOf[${i}]`, transformations),
    );
  }

  if (result.$defs) {
    const newDefs: Record<string, JSONSchema> = {};
    for (const [key, def] of Object.entries(result.$defs)) {
      newDefs[key] = expandRequired(def, `${path}.$defs.${key}`, transformations);
    }
    result.$defs = newDefs;
  }

  return result;
}

function makeNullable(schema: JSONSchema): JSONSchema {
  const result = { ...schema };

  // Already nullable
  if (Array.isArray(result.type) && result.type.includes('null')) {
    return result;
  }

  if (result.anyOf) {
    // Check if already has null option
    const hasNull = result.anyOf.some(s => s.type === 'null');
    if (!hasNull) {
      result.anyOf = [...result.anyOf, { type: 'null' }];
    }
    return result;
  }

  if (result.oneOf) {
    const hasNull = result.oneOf.some(s => s.type === 'null');
    if (!hasNull) {
      result.oneOf = [...result.oneOf, { type: 'null' }];
    }
    return result;
  }

  if (typeof result.type === 'string') {
    result.type = [result.type, 'null'];
    return result;
  }

  if (Array.isArray(result.type)) {
    if (!result.type.includes('null')) {
      result.type = [...result.type, 'null'];
    }
    return result;
  }

  // No type specified, wrap in anyOf with null
  return {
    anyOf: [result, { type: 'null' }],
  };
}

function removeUnsupportedKeywords(
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
        message: `Removed unsupported keyword "${keyword}" (value: ${JSON.stringify(value)})`,
        lossy: true,
      });
      warnings.push(`Removed "${keyword}" at ${path} — OpenAI strict mode does not support this keyword`);
    }
  }

  if (result.properties) {
    const newProps: Record<string, JSONSchema> = {};
    for (const [key, prop] of Object.entries(result.properties)) {
      newProps[key] = removeUnsupportedKeywords(prop, `${path}.properties.${key}`, transformations, warnings, options);
    }
    result.properties = newProps;
  }

  if (result.items && !Array.isArray(result.items)) {
    result.items = removeUnsupportedKeywords(result.items as JSONSchema, `${path}.items`, transformations, warnings, options);
  }

  if (result.anyOf) {
    result.anyOf = result.anyOf.map((s, i) =>
      removeUnsupportedKeywords(s, `${path}.anyOf[${i}]`, transformations, warnings, options),
    );
  }

  if (result.oneOf) {
    result.oneOf = result.oneOf.map((s, i) =>
      removeUnsupportedKeywords(s, `${path}.oneOf[${i}]`, transformations, warnings, options),
    );
  }

  if (result.allOf) {
    result.allOf = result.allOf.map((s, i) =>
      removeUnsupportedKeywords(s, `${path}.allOf[${i}]`, transformations, warnings, options),
    );
  }

  if (result.$defs) {
    const newDefs: Record<string, JSONSchema> = {};
    for (const [key, def] of Object.entries(result.$defs)) {
      newDefs[key] = removeUnsupportedKeywords(def, `${path}.$defs.${key}`, transformations, warnings, options);
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

  // Simplify allOf by merging
  if (result.allOf && result.allOf.length > 0) {
    let merged: JSONSchema = {};
    for (const sub of result.allOf) {
      merged = mergeSchemas(merged, sub);
    }
    // Copy merged properties to result
    const { allOf: _, ...rest } = result;
    result = { ...rest, ...merged };
    transformations.push({
      type: 'COMPOSITION_SIMPLIFIED',
      path,
      message: 'Merged allOf schemas into single schema',
      lossy: false,
    });
  }

  // Convert oneOf to anyOf
  if (result.oneOf) {
    result.anyOf = result.oneOf;
    delete result.oneOf;
    transformations.push({
      type: 'COMPOSITION_SIMPLIFIED',
      path,
      message: 'Converted oneOf to anyOf',
      lossy: false,
    });
  }

  // Remove not
  if (result.not) {
    delete result.not;
    transformations.push({
      type: 'COMPOSITION_SIMPLIFIED',
      path,
      message: 'Removed "not" keyword (not supported)',
      lossy: true,
    });
    warnings.push(`Removed "not" at ${path} — cannot be represented in OpenAI strict mode`);
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

  if (b.additionalProperties !== undefined) {
    result.additionalProperties = b.additionalProperties;
  }

  // Copy other keys from b that aren't in result
  for (const key of Object.keys(b)) {
    if (!(key in result)) {
      (result as Record<string, unknown>)[key] = (b as Record<string, unknown>)[key];
    }
  }

  return result;
}
