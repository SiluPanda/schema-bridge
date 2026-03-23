import { describe, it, expect } from 'vitest';
import { convertToOpenAI, wrapOpenAIResponseFormat } from '../providers/openai';
import type { JSONSchema } from '../types';

describe('convertToOpenAI', () => {
  describe('additionalProperties injection', () => {
    it('injects additionalProperties: false on root object', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.additionalProperties).toBe(false);
    });

    it('injects additionalProperties: false on nested objects', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          address: {
            type: 'object',
            properties: { street: { type: 'string' } },
            required: ['street'],
          },
        },
        required: ['address'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.additionalProperties).toBe(false);
      expect(result.properties!.address.additionalProperties).toBe(false);
    });

    it('does not re-inject if already false', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { x: { type: 'number' } },
        required: ['x'],
        additionalProperties: false,
      };
      const { schema: result, transformations } = convertToOpenAI(schema);
      expect(result.additionalProperties).toBe(false);
      const apInjections = transformations.filter(t => t.type === 'ADDITIONAL_PROPERTIES_INJECTED' && t.path === '$');
      expect(apInjections.length).toBe(0);
    });

    it('replaces additionalProperties: true with false', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { x: { type: 'number' } },
        required: ['x'],
        additionalProperties: true,
      };
      const { schema: result, transformations } = convertToOpenAI(schema);
      expect(result.additionalProperties).toBe(false);
      expect(transformations.some(t => t.type === 'ADDITIONAL_PROPERTIES_INJECTED')).toBe(true);
    });

    it('replaces additionalProperties schema object with false (lossy)', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { data: { type: 'string' } },
        required: ['data'],
        additionalProperties: { type: 'string' },
      };
      const { schema: result, transformations } = convertToOpenAI(schema);
      expect(result.additionalProperties).toBe(false);
      const lossy = transformations.find(
        t => t.type === 'ADDITIONAL_PROPERTIES_INJECTED' && t.lossy,
      );
      expect(lossy).toBeDefined();
    });

    it('injects on objects inside arrays', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'number' } },
              required: ['id'],
            },
          },
        },
        required: ['items'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect((result.properties!.items.items as JSONSchema).additionalProperties).toBe(false);
    });

    it('injects on objects inside anyOf', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            anyOf: [
              { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
              { type: 'null' },
            ],
          },
        },
        required: ['value'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.value.anyOf![0].additionalProperties).toBe(false);
    });

    it('injects on objects inside $defs', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { x: { type: 'string' } },
        required: ['x'],
        $defs: {
          Nested: {
            type: 'object',
            properties: { y: { type: 'number' } },
            required: ['y'],
          },
        },
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.$defs!.Nested.additionalProperties).toBe(false);
    });
  });

  describe('required expansion', () => {
    it('adds optional properties to required and makes them nullable', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          nickname: { type: 'string' },
        },
        required: ['name'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.required).toContain('name');
      expect(result.required).toContain('nickname');
      expect(result.properties!.nickname.type).toEqual(['string', 'null']);
    });

    it('does not modify already-required properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.name.type).toBe('string');
    });

    it('handles properties with no required array', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'number' },
        },
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.required).toContain('a');
      expect(result.required).toContain('b');
      expect(result.properties!.a.type).toEqual(['string', 'null']);
      expect(result.properties!.b.type).toEqual(['number', 'null']);
    });

    it('does not double-nullify already nullable properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          optional: { type: ['string', 'null'] },
        },
        required: [],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.optional.type).toEqual(['string', 'null']);
    });

    it('adds null to anyOf when property already uses anyOf', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            anyOf: [{ type: 'string' }, { type: 'number' }],
          },
        },
        required: [],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.value.anyOf).toContainEqual({ type: 'null' });
    });

    it('expands required recursively on nested objects', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            properties: {
              inner: { type: 'string' },
            },
          },
        },
        required: ['nested'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.nested.required).toContain('inner');
    });

    it('expands required inside oneOf schemas', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            oneOf: [
              {
                type: 'object',
                properties: { x: { type: 'string' } },
                required: [],
              },
            ],
          },
        },
        required: ['value'],
      };
      const { schema: result } = convertToOpenAI(schema);
      // oneOf gets converted to anyOf by simplifyComposition, then expandRequired recurses
      // The inner object should have 'x' in required
      const inner = result.properties!.value.anyOf?.[0] ?? result.properties!.value.oneOf?.[0];
      expect(inner).toBeDefined();
      expect(inner!.required).toContain('x');
    });

    it('expands required inside allOf schemas', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              nested: {
                type: 'object',
                properties: { a: { type: 'number' } },
              },
            },
          },
        },
        required: ['data'],
      };
      const { schema: result } = convertToOpenAI(schema);
      // nested object inside data should have 'a' expanded to required
      expect(result.properties!.data.properties!.nested.required).toContain('a');
    });
  });

  describe('keyword removal', () => {
    it('removes minimum', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          age: { type: 'number', minimum: 0 },
        },
        required: ['age'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.age.minimum).toBeUndefined();
    });

    it('removes maximum', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          score: { type: 'number', maximum: 100 },
        },
        required: ['score'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.score.maximum).toBeUndefined();
    });

    it('removes pattern', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          email: { type: 'string', pattern: '^[^@]+@[^@]+$' },
        },
        required: ['email'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.email.pattern).toBeUndefined();
    });

    it('removes format', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          date: { type: 'string', format: 'date-time' },
        },
        required: ['date'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.date.format).toBeUndefined();
    });

    it('removes default', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          mode: { type: 'string', default: 'auto' },
        },
        required: ['mode'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.mode.default).toBeUndefined();
    });

    it('removes examples', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', examples: ['Alice', 'Bob'] },
        },
        required: ['name'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.name.examples).toBeUndefined();
    });

    it('removes $comment', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          x: { type: 'string', $comment: 'test comment' },
        },
        required: ['x'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.x.$comment).toBeUndefined();
    });

    it('removes minLength and maxLength', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
        },
        required: ['name'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.name.minLength).toBeUndefined();
      expect(result.properties!.name.maxLength).toBeUndefined();
    });

    it('removes minItems and maxItems', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 },
        },
        required: ['tags'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.tags.minItems).toBeUndefined();
      expect(result.properties!.tags.maxItems).toBeUndefined();
    });

    it('removes multipleOf', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          step: { type: 'number', multipleOf: 0.5 },
        },
        required: ['step'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.step.multipleOf).toBeUndefined();
    });

    it('removes exclusiveMinimum and exclusiveMaximum', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          val: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 100 },
        },
        required: ['val'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.val.exclusiveMinimum).toBeUndefined();
      expect(result.properties!.val.exclusiveMaximum).toBeUndefined();
    });

    it('preserves title', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'User Name' },
        },
        required: ['name'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.name.title).toBe('User Name');
    });

    it('preserves description', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The user name' },
        },
        required: ['name'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.name.description).toBe('The user name');
    });

    it('records keyword removal transformations', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          age: { type: 'number', minimum: 0, maximum: 150 },
        },
        required: ['age'],
      };
      const { transformations } = convertToOpenAI(schema);
      const removals = transformations.filter(t => t.type === 'KEYWORD_REMOVED');
      expect(removals.length).toBeGreaterThanOrEqual(2);
      expect(removals.every(t => t.lossy)).toBe(true);
    });

    it('promotes constraints to description when option enabled', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          age: { type: 'number', minimum: 0, description: 'User age' },
        },
        required: ['age'],
      };
      const { schema: result } = convertToOpenAI(schema, {
        promoteConstraintsToDescription: true,
      });
      expect(result.properties!.age.description).toContain('minimum');
      expect(result.properties!.age.description).toContain('0');
    });
  });

  describe('composition simplification', () => {
    it('merges allOf into single schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          data: {
            allOf: [
              { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
              { properties: { b: { type: 'number' } }, required: ['b'] },
            ],
          },
        },
        required: ['data'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.data.properties!.a).toBeDefined();
      expect(result.properties!.data.properties!.b).toBeDefined();
      expect(result.properties!.data.allOf).toBeUndefined();
    });

    it('converts oneOf to anyOf', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            oneOf: [{ type: 'string' }, { type: 'number' }],
          },
        },
        required: ['value'],
      };
      const { schema: result } = convertToOpenAI(schema);
      expect(result.properties!.value.anyOf).toBeDefined();
      expect(result.properties!.value.oneOf).toBeUndefined();
    });

    it('removes not with lossy warning', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          x: { not: { type: 'string' }, type: 'number' },
        },
        required: ['x'],
      };
      const { schema: result, warnings } = convertToOpenAI(schema);
      expect(result.properties!.x.not).toBeUndefined();
      expect(warnings.some(w => w.includes('not'))).toBe(true);
    });
  });

  describe('strict: false mode', () => {
    it('does not inject additionalProperties when strict is false', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      };
      const { schema: result } = convertToOpenAI(schema, { strict: false });
      expect(result.additionalProperties).toBeUndefined();
    });

    it('does not expand required when strict is false', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          nickname: { type: 'string' },
        },
        required: ['name'],
      };
      const { schema: result } = convertToOpenAI(schema, { strict: false });
      expect(result.required).toEqual(['name']);
    });

    it('does not remove keywords when strict is false', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          age: { type: 'number', minimum: 0 },
        },
        required: ['age'],
      };
      const { schema: result } = convertToOpenAI(schema, { strict: false });
      expect(result.properties!.age.minimum).toBe(0);
    });
  });
});

describe('wrapOpenAIResponseFormat', () => {
  it('wraps schema in response_format envelope', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { x: { type: 'string' } },
    };
    const wrapped = wrapOpenAIResponseFormat(schema, 'test_schema');
    expect(wrapped.type).toBe('json_schema');
    expect((wrapped.json_schema as Record<string, unknown>).name).toBe('test_schema');
    expect((wrapped.json_schema as Record<string, unknown>).strict).toBe(true);
    expect((wrapped.json_schema as Record<string, unknown>).schema).toEqual(schema);
  });

  it('sets strict to false when specified', () => {
    const schema: JSONSchema = { type: 'object' };
    const wrapped = wrapOpenAIResponseFormat(schema, 'test', false);
    expect((wrapped.json_schema as Record<string, unknown>).strict).toBe(false);
  });
});
