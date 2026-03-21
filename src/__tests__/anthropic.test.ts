import { describe, it, expect } from 'vitest';
import { convertToAnthropic } from '../providers/anthropic';
import type { JSONSchema } from '../types';

describe('convertToAnthropic', () => {
  it('passes through schema with minimal changes', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number', minimum: 0 },
      },
      required: ['name'],
    };
    const { schema: result } = convertToAnthropic(schema);
    expect(result.type).toBe('object');
    expect(result.properties!.name.type).toBe('string');
    expect(result.properties!.age.minimum).toBe(0);
  });

  it('preserves constraints (minimum, maximum, pattern, format)', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        age: { type: 'number', minimum: 0, maximum: 150 },
        email: { type: 'string', pattern: '^[^@]+@[^@]+$', format: 'email' },
      },
      required: ['age', 'email'],
    };
    const { schema: result } = convertToAnthropic(schema);
    expect(result.properties!.age.minimum).toBe(0);
    expect(result.properties!.age.maximum).toBe(150);
    expect(result.properties!.email.pattern).toBe('^[^@]+@[^@]+$');
    expect(result.properties!.email.format).toBe('email');
  });

  it('preserves optional fields as truly optional', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        nickname: { type: 'string' },
      },
      required: ['name'],
    };
    const { schema: result } = convertToAnthropic(schema);
    expect(result.required).toEqual(['name']);
    expect(result.properties!.nickname.type).toBe('string'); // not nullable
  });

  it('removes $comment', () => {
    const schema: JSONSchema = {
      type: 'object',
      $comment: 'This is a test',
      properties: {
        x: { type: 'string', $comment: 'field comment' },
      },
      required: ['x'],
    };
    const { schema: result } = convertToAnthropic(schema);
    expect(result.$comment).toBeUndefined();
    expect(result.properties!.x.$comment).toBeUndefined();
  });

  it('preserves $ref and $defs', () => {
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
    const { schema: result } = convertToAnthropic(schema);
    expect(result.properties!.address.$ref).toBe('#/$defs/Address');
    expect(result.$defs).toBeDefined();
  });

  it('preserves anyOf/oneOf/allOf', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        a: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        b: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
        c: { allOf: [{ type: 'object', properties: { x: { type: 'string' } } }] },
      },
      required: ['a', 'b', 'c'],
    };
    const { schema: result } = convertToAnthropic(schema);
    expect(result.properties!.a.anyOf).toBeDefined();
    expect(result.properties!.b.oneOf).toBeDefined();
    expect(result.properties!.c.allOf).toBeDefined();
  });

  it('preserves default values', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        mode: { type: 'string', default: 'auto' },
      },
      required: ['mode'],
    };
    const { schema: result } = convertToAnthropic(schema);
    expect(result.properties!.mode.default).toBe('auto');
  });

  it('preserves enum', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'inactive'] },
      },
      required: ['status'],
    };
    const { schema: result } = convertToAnthropic(schema);
    expect(result.properties!.status.enum).toEqual(['active', 'inactive']);
  });

  describe('strict mode', () => {
    it('injects additionalProperties: false when strict is true', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };
      const { schema: result } = convertToAnthropic(schema, { strict: true });
      expect(result.additionalProperties).toBe(false);
    });

    it('injects additionalProperties: false on nested objects in strict mode', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            properties: { x: { type: 'number' } },
          },
        },
        required: ['nested'],
      };
      const { schema: result } = convertToAnthropic(schema, { strict: true });
      expect(result.additionalProperties).toBe(false);
      expect(result.properties!.nested.additionalProperties).toBe(false);
    });

    it('does not expand required in strict mode (Anthropic supports optional fields)', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          nickname: { type: 'string' },
        },
        required: ['name'],
      };
      const { schema: result } = convertToAnthropic(schema, { strict: true });
      expect(result.required).toEqual(['name']);
    });
  });

  it('does not inject additionalProperties by default', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    };
    const { schema: result } = convertToAnthropic(schema);
    expect(result.additionalProperties).toBeUndefined();
  });

  it('produces minimal transformations', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { x: { type: 'string' } },
      required: ['x'],
    };
    const { transformations } = convertToAnthropic(schema);
    expect(transformations.length).toBe(0);
  });

  it('records $comment removal transformation', () => {
    const schema: JSONSchema = {
      type: 'object',
      $comment: 'test',
      properties: {},
    };
    const { transformations } = convertToAnthropic(schema);
    expect(transformations.some(t => t.type === 'KEYWORD_REMOVED')).toBe(true);
  });
});
