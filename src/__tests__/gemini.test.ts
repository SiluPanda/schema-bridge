import { describe, it, expect } from 'vitest';
import { convertToGemini, wrapGeminiResponseFormat } from '../providers/gemini';
import type { JSONSchema } from '../types';

describe('convertToGemini', () => {
  it('removes default keyword', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        mode: { type: 'string', default: 'auto' },
      },
      required: ['mode'],
    };
    const { schema: result } = convertToGemini(schema);
    expect(result.properties!.mode.default).toBeUndefined();
  });

  it('removes examples keyword', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string', examples: ['Alice'] },
      },
      required: ['name'],
    };
    const { schema: result } = convertToGemini(schema);
    expect(result.properties!.name.examples).toBeUndefined();
  });

  it('removes $comment keyword', () => {
    const schema: JSONSchema = {
      type: 'object',
      $comment: 'test',
      properties: { x: { type: 'string', $comment: 'field' } },
      required: ['x'],
    };
    const { schema: result } = convertToGemini(schema);
    expect(result.$comment).toBeUndefined();
    expect(result.properties!.x.$comment).toBeUndefined();
  });

  it('preserves minimum and maximum (Gemini supports them)', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        age: { type: 'number', minimum: 0, maximum: 150 },
      },
      required: ['age'],
    };
    const { schema: result } = convertToGemini(schema);
    expect(result.properties!.age.minimum).toBe(0);
    expect(result.properties!.age.maximum).toBe(150);
  });

  it('preserves pattern', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        email: { type: 'string', pattern: '^[^@]+@' },
      },
      required: ['email'],
    };
    const { schema: result } = convertToGemini(schema);
    expect(result.properties!.email.pattern).toBe('^[^@]+@');
  });

  it('preserves $ref and $defs', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        ref: { $ref: '#/$defs/X' },
      },
      $defs: {
        X: { type: 'string' },
      },
    };
    const { schema: result } = convertToGemini(schema);
    expect(result.properties!.ref.$ref).toBe('#/$defs/X');
    expect(result.$defs).toBeDefined();
  });

  it('preserves anyOf', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        value: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['value'],
    };
    const { schema: result } = convertToGemini(schema);
    expect(result.properties!.value.anyOf).toBeDefined();
  });

  it('merges allOf schemas', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        data: {
          allOf: [
            { type: 'object', properties: { a: { type: 'string' } } },
            { properties: { b: { type: 'number' } } },
          ],
        },
      },
      required: ['data'],
    };
    const { schema: result } = convertToGemini(schema);
    expect(result.properties!.data.properties!.a).toBeDefined();
    expect(result.properties!.data.properties!.b).toBeDefined();
    expect(result.properties!.data.allOf).toBeUndefined();
  });

  it('removes not keyword', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        x: { type: 'number', not: { type: 'string' } },
      },
      required: ['x'],
    };
    const { schema: result, warnings } = convertToGemini(schema);
    expect(result.properties!.x.not).toBeUndefined();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('does not modify additionalProperties (not required for Gemini)', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    };
    const { schema: result } = convertToGemini(schema);
    expect(result.additionalProperties).toBeUndefined();
  });

  it('preserves enum values', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
      },
      required: ['status'],
    };
    const { schema: result } = convertToGemini(schema);
    expect(result.properties!.status.enum).toEqual(['active', 'inactive', 'pending']);
  });

  it('records transformations', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        x: { type: 'string', default: 'hello', $comment: 'c' },
      },
      required: ['x'],
    };
    const { transformations } = convertToGemini(schema);
    const removals = transformations.filter(t => t.type === 'KEYWORD_REMOVED');
    expect(removals.length).toBe(2);
  });

  it('promotes default to description when option enabled', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        mode: { type: 'string', default: 'auto', description: 'Output mode' },
      },
      required: ['mode'],
    };
    const { schema: result } = convertToGemini(schema, {
      promoteConstraintsToDescription: true,
    });
    expect(result.properties!.mode.description).toContain('default');
    expect(result.properties!.mode.description).toContain('auto');
  });
});

describe('wrapGeminiResponseFormat', () => {
  it('wraps schema in generationConfig envelope', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { x: { type: 'string' } },
    };
    const wrapped = wrapGeminiResponseFormat(schema);
    expect(wrapped.generationConfig).toBeDefined();
    const config = wrapped.generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBe('application/json');
    expect(config.responseSchema).toEqual(schema);
  });
});
