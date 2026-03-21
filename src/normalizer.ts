import type { JSONSchema, TransformationRecord } from './types';

/**
 * Deep clone a JSON Schema object.
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone) as T;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    result[key] = deepClone((obj as Record<string, unknown>)[key]);
  }
  return result as T;
}

/**
 * Normalize a JSON Schema to a canonical form (draft-2020-12 style).
 * - Converts `definitions` to `$defs`
 * - Handles array-form `items` to `prefixItems`
 * - Strips `$schema` property
 */
export function normalize(schema: JSONSchema): JSONSchema {
  const result = deepClone(schema);
  return normalizeNode(result);
}

function normalizeNode(node: JSONSchema): JSONSchema {
  // Convert definitions to $defs
  if (node.definitions) {
    if (!node.$defs) {
      node.$defs = node.definitions;
    }
    delete node.definitions;
  }

  // Convert array-form items to prefixItems
  if (Array.isArray(node.items)) {
    node.prefixItems = node.items as JSONSchema[];
    delete node.items;
  }

  // Strip $schema
  delete node.$schema;

  // Recurse into subschemas
  if (node.properties) {
    for (const key of Object.keys(node.properties)) {
      node.properties[key] = normalizeNode(node.properties[key]);
    }
  }

  if (node.items && !Array.isArray(node.items)) {
    node.items = normalizeNode(node.items as JSONSchema);
  }

  if (node.prefixItems) {
    node.prefixItems = node.prefixItems.map(normalizeNode);
  }

  if (node.additionalProperties && typeof node.additionalProperties === 'object') {
    node.additionalProperties = normalizeNode(node.additionalProperties as JSONSchema);
  }

  if (node.anyOf) {
    node.anyOf = node.anyOf.map(normalizeNode);
  }

  if (node.oneOf) {
    node.oneOf = node.oneOf.map(normalizeNode);
  }

  if (node.allOf) {
    node.allOf = node.allOf.map(normalizeNode);
  }

  if (node.not) {
    node.not = normalizeNode(node.not);
  }

  if (node.$defs) {
    for (const key of Object.keys(node.$defs)) {
      node.$defs[key] = normalizeNode(node.$defs[key]);
    }
  }

  return node;
}

/**
 * Resolve all $ref references by inlining them.
 * Returns the resolved schema and a list of transformation records.
 */
export function resolveRefs(
  schema: JSONSchema,
  options?: { maxRecursionDepth?: number; preserveRefs?: boolean }
): { schema: JSONSchema; transformations: TransformationRecord[] } {
  const maxDepth = options?.maxRecursionDepth ?? 5;
  const preserveRefs = options?.preserveRefs ?? false;
  const transformations: TransformationRecord[] = [];
  const defs = schema.$defs || schema.definitions || {};

  // Detect which refs are recursive
  const recursiveRefs = detectRecursiveRefs(schema, defs);

  const resolved = resolveNode(schema, defs, '$', new Set(), transformations, maxDepth, preserveRefs, recursiveRefs);

  // If all $refs were inlined (no recursive refs preserved), remove $defs
  if (!preserveRefs && !hasRemainingRefs(resolved)) {
    delete resolved.$defs;
    delete resolved.definitions;
  }

  return { schema: resolved, transformations };
}

function detectRecursiveRefs(schema: JSONSchema, defs: Record<string, JSONSchema>): Set<string> {
  const recursive = new Set<string>();

  function visit(node: JSONSchema, visiting: Set<string>): void {
    if (node.$ref) {
      const refName = extractRefName(node.$ref);
      if (refName && visiting.has(refName)) {
        recursive.add(refName);
        return;
      }
      if (refName && defs[refName]) {
        visiting.add(refName);
        visit(defs[refName], visiting);
        visiting.delete(refName);
      }
      return;
    }

    if (node.properties) {
      for (const prop of Object.values(node.properties)) {
        visit(prop, visiting);
      }
    }
    if (node.items && !Array.isArray(node.items)) {
      visit(node.items as JSONSchema, visiting);
    }
    if (Array.isArray(node.items)) {
      for (const item of node.items) {
        visit(item, visiting);
      }
    }
    if (node.prefixItems) {
      for (const item of node.prefixItems) {
        visit(item, visiting);
      }
    }
    if (node.anyOf) {
      for (const s of node.anyOf) visit(s, visiting);
    }
    if (node.oneOf) {
      for (const s of node.oneOf) visit(s, visiting);
    }
    if (node.allOf) {
      for (const s of node.allOf) visit(s, visiting);
    }
    if (node.additionalProperties && typeof node.additionalProperties === 'object') {
      visit(node.additionalProperties as JSONSchema, visiting);
    }
  }

  // Visit from each def
  for (const [name, def] of Object.entries(defs)) {
    const visiting = new Set<string>();
    visiting.add(name);
    visit(def, visiting);
  }

  // Also visit from root
  visit(schema, new Set());

  return recursive;
}

function extractRefName(ref: string): string | null {
  const match = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/);
  return match ? match[1] : null;
}

function hasRemainingRefs(schema: JSONSchema): boolean {
  if (schema.$ref) return true;
  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      if (hasRemainingRefs(prop)) return true;
    }
  }
  if (schema.items && !Array.isArray(schema.items)) {
    if (hasRemainingRefs(schema.items as JSONSchema)) return true;
  }
  if (schema.anyOf) {
    for (const s of schema.anyOf) if (hasRemainingRefs(s)) return true;
  }
  if (schema.oneOf) {
    for (const s of schema.oneOf) if (hasRemainingRefs(s)) return true;
  }
  if (schema.allOf) {
    for (const s of schema.allOf) if (hasRemainingRefs(s)) return true;
  }
  if (schema.$defs) {
    for (const def of Object.values(schema.$defs)) {
      if (hasRemainingRefs(def)) return true;
    }
  }
  return false;
}

function resolveNode(
  node: JSONSchema,
  defs: Record<string, JSONSchema>,
  path: string,
  visiting: Set<string>,
  transformations: TransformationRecord[],
  maxDepth: number,
  preserveRefs: boolean,
  recursiveRefs: Set<string>,
  depth: number = 0,
): JSONSchema {
  const result = deepClone(node);

  if (result.$ref) {
    const refName = extractRefName(result.$ref);
    if (refName && defs[refName]) {
      // Recursive ref
      if (recursiveRefs.has(refName)) {
        if (preserveRefs) {
          // Keep the $ref as-is for providers that support it
          return result;
        }
        if (visiting.has(refName) || depth >= maxDepth) {
          // Truncate recursion
          transformations.push({
            type: 'RECURSIVE_SCHEMA_TRUNCATED',
            path,
            message: `Recursive $ref to ${refName} truncated at depth ${depth}`,
            lossy: true,
          });
          return { type: 'object' };
        }
      }

      // Inline the ref
      transformations.push({
        type: 'REF_INLINED',
        path,
        message: `Inlined $ref ${result.$ref}`,
        lossy: false,
      });

      const newVisiting = new Set(visiting);
      newVisiting.add(refName);
      return resolveNode(
        deepClone(defs[refName]),
        defs,
        path,
        newVisiting,
        transformations,
        maxDepth,
        preserveRefs,
        recursiveRefs,
        depth + 1,
      );
    }
    return result;
  }

  if (result.properties) {
    for (const [key, prop] of Object.entries(result.properties)) {
      result.properties[key] = resolveNode(
        prop, defs, `${path}.properties.${key}`, visiting, transformations, maxDepth, preserveRefs, recursiveRefs, depth,
      );
    }
  }

  if (result.items && !Array.isArray(result.items)) {
    result.items = resolveNode(
      result.items as JSONSchema, defs, `${path}.items`, visiting, transformations, maxDepth, preserveRefs, recursiveRefs, depth,
    );
  }

  if (result.prefixItems) {
    result.prefixItems = result.prefixItems.map((item, i) =>
      resolveNode(item, defs, `${path}.prefixItems[${i}]`, visiting, transformations, maxDepth, preserveRefs, recursiveRefs, depth),
    );
  }

  if (result.anyOf) {
    result.anyOf = result.anyOf.map((s, i) =>
      resolveNode(s, defs, `${path}.anyOf[${i}]`, visiting, transformations, maxDepth, preserveRefs, recursiveRefs, depth),
    );
  }

  if (result.oneOf) {
    result.oneOf = result.oneOf.map((s, i) =>
      resolveNode(s, defs, `${path}.oneOf[${i}]`, visiting, transformations, maxDepth, preserveRefs, recursiveRefs, depth),
    );
  }

  if (result.allOf) {
    result.allOf = result.allOf.map((s, i) =>
      resolveNode(s, defs, `${path}.allOf[${i}]`, visiting, transformations, maxDepth, preserveRefs, recursiveRefs, depth),
    );
  }

  if (result.additionalProperties && typeof result.additionalProperties === 'object') {
    result.additionalProperties = resolveNode(
      result.additionalProperties as JSONSchema, defs, `${path}.additionalProperties`, visiting, transformations, maxDepth, preserveRefs, recursiveRefs, depth,
    );
  }

  if (result.$defs) {
    for (const [key, def] of Object.entries(result.$defs)) {
      result.$defs[key] = resolveNode(
        def, defs, `${path}.$defs.${key}`, visiting, transformations, maxDepth, preserveRefs, recursiveRefs, depth,
      );
    }
  }

  return result;
}
