import { describe, it, expect } from 'vitest';
import { normalize, resolveRefs, deepClone } from '../normalizer';
import type { JSONSchema } from '../types';

describe('normalize', () => {
  it('converts definitions to $defs', () => {
    const schema: JSONSchema = {
      type: 'object',
      definitions: {
        Address: { type: 'object', properties: { street: { type: 'string' } } },
      },
    };
    const result = normalize(schema);
    expect(result.$defs).toBeDefined();
    expect(result.$defs!.Address).toBeDefined();
    expect(result.definitions).toBeUndefined();
  });

  it('preserves existing $defs', () => {
    const schema: JSONSchema = {
      type: 'object',
      $defs: {
        Name: { type: 'string' },
      },
    };
    const result = normalize(schema);
    expect(result.$defs!.Name).toEqual({ type: 'string' });
  });

  it('does not overwrite $defs with definitions if both exist', () => {
    const schema: JSONSchema = {
      type: 'object',
      $defs: { A: { type: 'string' } },
      definitions: { B: { type: 'number' } },
    };
    const result = normalize(schema);
    // $defs takes priority, definitions not copied
    expect(result.$defs!.A).toBeDefined();
    expect(result.definitions).toBeUndefined();
  });

  it('converts array-form items to prefixItems', () => {
    const schema: JSONSchema = {
      type: 'array',
      items: [{ type: 'string' }, { type: 'number' }],
    };
    const result = normalize(schema);
    expect(result.prefixItems).toEqual([{ type: 'string' }, { type: 'number' }]);
    expect(result.items).toBeUndefined();
  });

  it('preserves single-item items (not array form)', () => {
    const schema: JSONSchema = {
      type: 'array',
      items: { type: 'string' },
    };
    const result = normalize(schema);
    expect(result.items).toEqual({ type: 'string' });
    expect(result.prefixItems).toBeUndefined();
  });

  it('strips $schema property', () => {
    const schema: JSONSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { name: { type: 'string' } },
    };
    const result = normalize(schema);
    expect(result.$schema).toBeUndefined();
  });

  it('normalizes nested schemas recursively', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          definitions: {
            Inner: { type: 'string' },
          },
        },
      },
    };
    const result = normalize(schema);
    expect(result.properties!.nested.$defs).toBeDefined();
    expect(result.properties!.nested.definitions).toBeUndefined();
  });

  it('normalizes schemas inside anyOf', () => {
    const schema: JSONSchema = {
      anyOf: [
        { type: 'string' },
        { type: 'object', definitions: { X: { type: 'number' } } },
      ],
    };
    const result = normalize(schema);
    expect(result.anyOf![1].$defs).toBeDefined();
    expect(result.anyOf![1].definitions).toBeUndefined();
  });

  it('normalizes schemas inside oneOf', () => {
    const schema: JSONSchema = {
      oneOf: [
        { type: 'string' },
        { $schema: 'http://json-schema.org/draft-07/schema#', type: 'number' },
      ],
    };
    const result = normalize(schema);
    expect(result.oneOf![1].$schema).toBeUndefined();
  });

  it('normalizes schemas inside allOf', () => {
    const schema: JSONSchema = {
      allOf: [
        { type: 'object', definitions: { Y: { type: 'boolean' } } },
      ],
    };
    const result = normalize(schema);
    expect(result.allOf![0].$defs).toBeDefined();
  });

  it('normalizes additionalProperties when it is a schema', () => {
    const schema: JSONSchema = {
      type: 'object',
      additionalProperties: {
        definitions: { Z: { type: 'string' } },
        type: 'object',
      },
    };
    const result = normalize(schema);
    expect((result.additionalProperties as JSONSchema).$defs).toBeDefined();
  });

  it('normalizes not subschema', () => {
    const schema: JSONSchema = {
      not: { $schema: 'draft-07', type: 'string' },
    };
    const result = normalize(schema);
    expect(result.not!.$schema).toBeUndefined();
  });

  it('does not mutate the original schema', () => {
    const schema: JSONSchema = {
      type: 'object',
      definitions: { A: { type: 'string' } },
    };
    normalize(schema);
    expect(schema.definitions).toBeDefined();
    expect(schema.$defs).toBeUndefined();
  });

  it('handles empty schema', () => {
    const schema: JSONSchema = {};
    const result = normalize(schema);
    expect(result).toEqual({});
  });

  it('handles schema with only type', () => {
    const schema: JSONSchema = { type: 'string' };
    const result = normalize(schema);
    expect(result).toEqual({ type: 'string' });
  });

  it('normalizes prefixItems recursively', () => {
    const schema: JSONSchema = {
      type: 'array',
      prefixItems: [
        { type: 'object', definitions: { P: { type: 'string' } } },
      ],
    };
    const result = normalize(schema);
    expect(result.prefixItems![0].$defs).toBeDefined();
  });
});

describe('resolveRefs', () => {
  it('inlines a simple $ref', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        address: { $ref: '#/$defs/Address' },
      },
      $defs: {
        Address: {
          type: 'object',
          properties: { street: { type: 'string' } },
        },
      },
    };
    const { schema: result, transformations } = resolveRefs(schema);
    expect(result.properties!.address.type).toBe('object');
    expect(result.properties!.address.properties!.street.type).toBe('string');
    expect(result.properties!.address.$ref).toBeUndefined();
    expect(transformations.length).toBeGreaterThan(0);
    expect(transformations[0].type).toBe('REF_INLINED');
  });

  it('inlines multiple refs to the same definition independently', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        home: { $ref: '#/$defs/Address' },
        work: { $ref: '#/$defs/Address' },
      },
      $defs: {
        Address: {
          type: 'object',
          properties: { city: { type: 'string' } },
        },
      },
    };
    const { schema: result } = resolveRefs(schema);
    expect(result.properties!.home.properties!.city.type).toBe('string');
    expect(result.properties!.work.properties!.city.type).toBe('string');
    // They should be independent objects (deep clone)
    expect(result.properties!.home).not.toBe(result.properties!.work);
  });

  it('handles #/definitions/ style refs', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        item: { $ref: '#/definitions/Item' },
      },
      definitions: {
        Item: { type: 'string' },
      },
    };
    const { schema: result } = resolveRefs(schema);
    expect(result.properties!.item.type).toBe('string');
  });

  it('removes $defs after all refs are inlined', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { $ref: '#/$defs/Name' },
      },
      $defs: {
        Name: { type: 'string' },
      },
    };
    const { schema: result } = resolveRefs(schema);
    expect(result.$defs).toBeUndefined();
  });

  it('resolves refs inside anyOf', () => {
    const schema: JSONSchema = {
      anyOf: [
        { $ref: '#/$defs/A' },
        { type: 'null' },
      ],
      $defs: {
        A: { type: 'string' },
      },
    };
    const { schema: result } = resolveRefs(schema);
    expect(result.anyOf![0].type).toBe('string');
  });

  it('resolves refs inside items', () => {
    const schema: JSONSchema = {
      type: 'array',
      items: { $ref: '#/$defs/Item' },
      $defs: {
        Item: { type: 'number' },
      },
    };
    const { schema: result } = resolveRefs(schema);
    expect((result.items as JSONSchema).type).toBe('number');
  });

  it('detects recursive refs and truncates when not preserving', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        children: {
          type: 'array',
          items: { $ref: '#/$defs/Node' },
        },
      },
      $defs: {
        Node: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            children: {
              type: 'array',
              items: { $ref: '#/$defs/Node' },
            },
          },
        },
      },
    };
    const { schema: result, transformations } = resolveRefs(schema, {
      preserveRefs: false,
      maxRecursionDepth: 2,
    });
    const hasTruncation = transformations.some(t => t.type === 'RECURSIVE_SCHEMA_TRUNCATED');
    expect(hasTruncation).toBe(true);
  });

  it('preserves recursive refs when preserveRefs is true', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        child: { $ref: '#/$defs/Node' },
      },
      $defs: {
        Node: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            child: { $ref: '#/$defs/Node' },
          },
        },
      },
    };
    const { schema: result } = resolveRefs(schema, { preserveRefs: true });
    // The recursive $ref should be preserved
    expect(result.$defs).toBeDefined();
  });

  it('handles nested $ref chains', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        a: { $ref: '#/$defs/A' },
      },
      $defs: {
        A: { $ref: '#/$defs/B' },
        B: { type: 'string' },
      },
    };
    const { schema: result } = resolveRefs(schema);
    expect(result.properties!.a.type).toBe('string');
  });

  it('leaves unknown $ref unchanged', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        ext: { $ref: 'https://example.com/schema.json' },
      },
    };
    const { schema: result } = resolveRefs(schema);
    expect(result.properties!.ext.$ref).toBe('https://example.com/schema.json');
  });
});

describe('deepClone', () => {
  it('deep clones objects', () => {
    const original = { a: { b: [1, 2, { c: 3 }] } };
    const cloned = deepClone(original);
    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.a).not.toBe(original.a);
    expect(cloned.a.b).not.toBe(original.a.b);
  });

  it('handles null', () => {
    expect(deepClone(null)).toBeNull();
  });

  it('handles primitives', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(true)).toBe(true);
  });

  it('handles arrays', () => {
    const arr = [1, [2, 3], { a: 4 }];
    const cloned = deepClone(arr);
    expect(cloned).toEqual(arr);
    expect(cloned).not.toBe(arr);
  });
});
