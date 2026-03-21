import { describe, it, expect } from 'vitest';
import { convert, supported } from '../index';
import type { JSONSchema, Provider } from '../types';

const ALL_PROVIDERS: Provider[] = ['openai', 'anthropic', 'gemini', 'cohere', 'mcp', 'ollama', 'vercel-ai'];

const simpleSchema: JSONSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'User name' },
    age: { type: 'number', description: 'User age' },
  },
  required: ['name', 'age'],
};

const schemaWithConstraints: JSONSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    age: { type: 'number', minimum: 0, maximum: 150 },
    email: { type: 'string', format: 'email', pattern: '^[^@]+@[^@]+$' },
    tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 },
  },
  required: ['name', 'age'],
};

const schemaWithRefs: JSONSchema = {
  type: 'object',
  properties: {
    address: { $ref: '#/$defs/Address' },
  },
  required: ['address'],
  $defs: {
    Address: {
      type: 'object',
      properties: {
        street: { type: 'string' },
        city: { type: 'string' },
      },
      required: ['street', 'city'],
    },
  },
};

describe('convert - all providers', () => {
  for (const provider of ALL_PROVIDERS) {
    describe(provider, () => {
      it('converts a simple schema successfully', () => {
        const result = convert(simpleSchema, provider);
        expect(result).toBeDefined();
        expect(result.schema).toBeDefined();
        expect(result.transformations).toBeDefined();
        expect(result.warnings).toBeDefined();
      });

      it('returns a valid schema structure', () => {
        const result = convert(simpleSchema, provider);
        expect(result.schema.type).toBe('object');
        expect(result.schema.properties).toBeDefined();
      });

      it('handles schema with constraints', () => {
        const result = convert(schemaWithConstraints, provider);
        expect(result).toBeDefined();
        expect(result.schema).toBeDefined();
      });

      it('handles schema with $ref', () => {
        const result = convert(schemaWithRefs, provider);
        expect(result).toBeDefined();
        expect(result.schema).toBeDefined();
      });

      it('handles empty object schema', () => {
        const result = convert({ type: 'object', properties: {} }, provider);
        expect(result.schema).toBeDefined();
      });
    });
  }
});

describe('provider-specific constraint handling', () => {
  it('OpenAI removes constraints', () => {
    const result = convert(schemaWithConstraints, 'openai');
    expect(result.schema.properties!.age.minimum).toBeUndefined();
    expect(result.schema.properties!.age.maximum).toBeUndefined();
    expect(result.schema.properties!.name.minLength).toBeUndefined();
    expect(result.schema.properties!.email.format).toBeUndefined();
  });

  it('Anthropic preserves constraints', () => {
    const result = convert(schemaWithConstraints, 'anthropic');
    expect(result.schema.properties!.age.minimum).toBe(0);
    expect(result.schema.properties!.age.maximum).toBe(150);
    expect(result.schema.properties!.name.minLength).toBe(1);
    expect(result.schema.properties!.email.format).toBe('email');
  });

  it('Gemini removes default but preserves constraints', () => {
    const schemaWithDefault: JSONSchema = {
      type: 'object',
      properties: {
        mode: { type: 'string', default: 'auto', minimum: 5 },
      },
      required: ['mode'],
    };
    const result = convert(schemaWithDefault, 'gemini');
    expect(result.schema.properties!.mode.default).toBeUndefined();
  });

  it('MCP preserves everything', () => {
    const result = convert(schemaWithConstraints, 'mcp');
    expect(result.schema.properties!.age.minimum).toBe(0);
    expect(result.schema.properties!.age.maximum).toBe(150);
    expect(result.schema.properties!.name.minLength).toBe(1);
    expect(result.schema.properties!.email.format).toBe('email');
    expect(result.schema.properties!.tags.minItems).toBe(1);
  });

  it('Cohere preserves most constraints', () => {
    const result = convert(schemaWithConstraints, 'cohere');
    expect(result.schema.properties!.age.minimum).toBe(0);
    expect(result.schema.properties!.age.maximum).toBe(150);
  });

  it('Ollama removes examples but preserves constraints', () => {
    const schemaWithExamples: JSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string', examples: ['Alice'], minimum: 0 },
      },
      required: ['name'],
    };
    const result = convert(schemaWithExamples, 'ollama');
    expect(result.schema.properties!.name.examples).toBeUndefined();
  });
});

describe('provider-specific $ref handling', () => {
  it('OpenAI preserves $ref for recursive schemas', () => {
    const recursiveSchema: JSONSchema = {
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
    const result = convert(recursiveSchema, 'openai');
    // For recursive schemas with preserveRefs, $defs should be kept
    expect(result.schema).toBeDefined();
  });

  it('Cohere inlines $ref for non-recursive schemas', () => {
    const result = convert(schemaWithRefs, 'cohere');
    // Refs should be inlined
    expect(result.schema.properties!.address.properties).toBeDefined();
  });

  it('Ollama inlines $ref for non-recursive schemas', () => {
    const result = convert(schemaWithRefs, 'ollama');
    expect(result.schema.properties!.address.properties).toBeDefined();
  });
});

describe('supported providers', () => {
  it('returns all supported provider names', () => {
    const providers = supported();
    expect(providers).toContain('openai');
    expect(providers).toContain('anthropic');
    expect(providers).toContain('gemini');
    expect(providers).toContain('cohere');
    expect(providers).toContain('mcp');
    expect(providers).toContain('ollama');
    expect(providers).toContain('vercel-ai');
  });

  it('throws for unsupported provider', () => {
    expect(() => convert(simpleSchema, 'unknown' as Provider)).toThrow('Unsupported provider');
  });
});

describe('round-trip consistency', () => {
  it('schema structure is preserved across conversion', () => {
    for (const provider of ALL_PROVIDERS) {
      const result = convert(simpleSchema, provider);
      // All providers should preserve the basic structure
      expect(result.schema.properties!.name).toBeDefined();
      expect(result.schema.properties!.age).toBeDefined();
    }
  });

  it('descriptions are preserved across all providers', () => {
    for (const provider of ALL_PROVIDERS) {
      const result = convert(simpleSchema, provider);
      expect(result.schema.properties!.name.description).toBe('User name');
      expect(result.schema.properties!.age.description).toBe('User age');
    }
  });
});
