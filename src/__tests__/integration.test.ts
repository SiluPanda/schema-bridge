import { describe, it, expect } from 'vitest';
import { convert, convertTool, convertTools, normalize, resolveRefs, supported } from '../index';
import type { JSONSchema, Provider, OpenAIToolDefinition, AnthropicToolDefinition, MCPToolDefinition } from '../types';

const ALL_PROVIDERS: Provider[] = ['openai', 'anthropic', 'gemini', 'cohere', 'mcp', 'ollama', 'vercel-ai'];

describe('integration: complex schemas across all providers', () => {
  const complexSchema: JSONSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Full name', minLength: 1, maxLength: 200 },
      age: { type: 'number', description: 'Age in years', minimum: 0, maximum: 150 },
      email: { type: 'string', format: 'email', pattern: '^[^@]+@[^@]+\\.[^@]+$' },
      roles: {
        type: 'array',
        items: { type: 'string', enum: ['admin', 'user', 'guest'] },
        minItems: 1,
        maxItems: 3,
      },
      address: {
        type: 'object',
        properties: {
          street: { type: 'string' },
          city: { type: 'string' },
          zip: { type: 'string', pattern: '^\\d{5}$' },
        },
        required: ['street', 'city'],
      },
      metadata: {
        type: 'object',
        properties: {
          createdAt: { type: 'string', format: 'date-time' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    required: ['name', 'email'],
  };

  for (const provider of ALL_PROVIDERS) {
    it(`converts complex schema for ${provider} without errors`, () => {
      const result = convert(complexSchema, provider);
      expect(result).toBeDefined();
      expect(result.schema).toBeDefined();
      expect(result.schema.properties).toBeDefined();
      expect(result.schema.properties!.name).toBeDefined();
    });
  }

  it('OpenAI complex schema has additionalProperties: false everywhere', () => {
    const result = convert(complexSchema, 'openai');
    expect(result.schema.additionalProperties).toBe(false);
    expect(result.schema.properties!.address.additionalProperties).toBe(false);
    expect(result.schema.properties!.metadata.additionalProperties).toBe(false);
  });

  it('OpenAI complex schema has all properties required', () => {
    const result = convert(complexSchema, 'openai');
    const required = result.schema.required!;
    expect(required).toContain('name');
    expect(required).toContain('age');
    expect(required).toContain('email');
    expect(required).toContain('roles');
    expect(required).toContain('address');
    expect(required).toContain('metadata');
  });

  it('OpenAI complex schema removes all constraints', () => {
    const result = convert(complexSchema, 'openai');
    expect(result.schema.properties!.name.minLength).toBeUndefined();
    expect(result.schema.properties!.name.maxLength).toBeUndefined();
    expect(result.schema.properties!.age.minimum).toBeUndefined();
    expect(result.schema.properties!.age.maximum).toBeUndefined();
    expect(result.schema.properties!.email.format).toBeUndefined();
    expect(result.schema.properties!.email.pattern).toBeUndefined();
    expect(result.schema.properties!.roles.minItems).toBeUndefined();
    expect(result.schema.properties!.roles.maxItems).toBeUndefined();
  });

  it('Anthropic complex schema preserves constraints', () => {
    const result = convert(complexSchema, 'anthropic');
    expect(result.schema.properties!.name.minLength).toBe(1);
    expect(result.schema.properties!.age.minimum).toBe(0);
    expect(result.schema.properties!.email.format).toBe('email');
  });

  it('MCP complex schema preserves everything', () => {
    const result = convert(complexSchema, 'mcp');
    expect(result.schema.properties!.name.minLength).toBe(1);
    expect(result.schema.properties!.name.maxLength).toBe(200);
    expect(result.schema.properties!.age.minimum).toBe(0);
    expect(result.schema.properties!.age.maximum).toBe(150);
    expect(result.schema.properties!.email.format).toBe('email');
    expect(result.schema.properties!.email.pattern).toBeDefined();
    expect(result.schema.properties!.roles.minItems).toBe(1);
    expect(result.schema.properties!.roles.maxItems).toBe(3);
  });
});

describe('integration: schema with $ref', () => {
  const schemaWithRefs: JSONSchema = {
    type: 'object',
    properties: {
      billing: { $ref: '#/$defs/Address' },
      shipping: { $ref: '#/$defs/Address' },
    },
    required: ['billing'],
    $defs: {
      Address: {
        type: 'object',
        properties: {
          line1: { type: 'string' },
          line2: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          zip: { type: 'string' },
        },
        required: ['line1', 'city', 'state', 'zip'],
      },
    },
  };

  for (const provider of ALL_PROVIDERS) {
    it(`handles $ref schema for ${provider}`, () => {
      const result = convert(schemaWithRefs, provider);
      expect(result).toBeDefined();
      expect(result.schema.properties).toBeDefined();
    });
  }
});

describe('integration: recursive schema', () => {
  const recursiveSchema: JSONSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      children: {
        type: 'array',
        items: { $ref: '#/$defs/TreeNode' },
      },
    },
    required: ['name'],
    $defs: {
      TreeNode: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          children: {
            type: 'array',
            items: { $ref: '#/$defs/TreeNode' },
          },
        },
        required: ['name'],
      },
    },
  };

  for (const provider of ALL_PROVIDERS) {
    it(`handles recursive schema for ${provider} without stack overflow`, () => {
      const result = convert(recursiveSchema, provider);
      expect(result).toBeDefined();
      expect(result.schema).toBeDefined();
    });
  }
});

describe('integration: enum schema', () => {
  const enumSchema: JSONSchema = {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['active', 'inactive', 'suspended', 'deleted'] },
      priority: { type: 'number', enum: [1, 2, 3, 4, 5] },
      color: {
        type: 'string',
        enum: ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'black', 'white'],
      },
    },
    required: ['status', 'priority'],
  };

  for (const provider of ALL_PROVIDERS) {
    it(`preserves enums for ${provider}`, () => {
      const result = convert(enumSchema, provider);
      expect(result.schema.properties!.status.enum).toBeDefined();
      expect(result.schema.properties!.status.enum!.length).toBe(4);
      expect(result.schema.properties!.priority.enum).toBeDefined();
    });
  }
});

describe('integration: deeply nested schema', () => {
  const deepSchema: JSONSchema = {
    type: 'object',
    properties: {
      level1: {
        type: 'object',
        properties: {
          level2: {
            type: 'object',
            properties: {
              level3: {
                type: 'object',
                properties: {
                  value: { type: 'string' },
                },
                required: ['value'],
              },
            },
            required: ['level3'],
          },
        },
        required: ['level2'],
      },
    },
    required: ['level1'],
  };

  for (const provider of ALL_PROVIDERS) {
    it(`handles deeply nested schema for ${provider}`, () => {
      const result = convert(deepSchema, provider);
      expect(result).toBeDefined();
      expect(result.schema.properties!.level1).toBeDefined();
    });
  }

  it('OpenAI adds additionalProperties to all nested levels', () => {
    const result = convert(deepSchema, 'openai');
    expect(result.schema.additionalProperties).toBe(false);
    expect(result.schema.properties!.level1.additionalProperties).toBe(false);
    expect(result.schema.properties!.level1.properties!.level2.additionalProperties).toBe(false);
    expect(
      result.schema.properties!.level1.properties!.level2.properties!.level3.additionalProperties,
    ).toBe(false);
  });
});

describe('integration: anyOf/oneOf/allOf schemas', () => {
  const compositionSchema: JSONSchema = {
    type: 'object',
    properties: {
      nullableField: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
      },
      unionField: {
        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
      },
      mergedField: {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { properties: { b: { type: 'number' } }, required: ['b'] },
        ],
      },
    },
    required: ['nullableField'],
  };

  it('OpenAI simplifies composition keywords', () => {
    const result = convert(compositionSchema, 'openai');
    // oneOf should be converted to anyOf (inside nullable wrapper since it was optional)
    const unionField = result.schema.properties!.unionField;
    // unionField is optional so it gets wrapped in anyOf with null
    // The original oneOf entries become anyOf entries (plus null)
    expect(unionField.anyOf).toBeDefined();

    // allOf should be merged — mergedField is optional so wrapped in anyOf with null
    const mergedField = result.schema.properties!.mergedField;
    // The allOf was merged into a single object, then made nullable
    expect(mergedField.anyOf).toBeDefined();
    const nonNullOption = mergedField.anyOf!.find((s: JSONSchema) => s.type !== 'null');
    expect(nonNullOption).toBeDefined();
    expect(nonNullOption!.properties).toBeDefined();
    expect(nonNullOption!.properties!.a).toBeDefined();
    expect(nonNullOption!.properties!.b).toBeDefined();
  });

  it('Anthropic preserves composition keywords', () => {
    const result = convert(compositionSchema, 'anthropic');
    expect(result.schema.properties!.nullableField.anyOf).toBeDefined();
    expect(result.schema.properties!.unionField.oneOf).toBeDefined();
    expect(result.schema.properties!.mergedField.allOf).toBeDefined();
  });
});

describe('integration: tool definitions across providers', () => {
  const tool = {
    name: 'search_web',
    description: 'Search the web for information',
    schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Search query' },
        limit: { type: 'number' as const, minimum: 1, maximum: 100 },
      },
      required: ['query'],
    },
  };

  it('converts tool for OpenAI', () => {
    const result = convertTool(tool, 'openai');
    const openaiTool = result.tool as OpenAIToolDefinition;
    expect(openaiTool.type).toBe('function');
    expect(openaiTool.function.name).toBe('search_web');
    expect(openaiTool.function.parameters.additionalProperties).toBe(false);
  });

  it('converts tool for Anthropic', () => {
    const result = convertTool(tool, 'anthropic');
    const anthropicTool = result.tool as AnthropicToolDefinition;
    expect(anthropicTool.name).toBe('search_web');
    expect(anthropicTool.input_schema).toBeDefined();
  });

  it('converts tool for MCP with outputSchema', () => {
    const toolWithOutput = {
      ...tool,
      outputSchema: {
        type: 'object' as const,
        properties: {
          results: { type: 'array' as const, items: { type: 'string' as const } },
        },
        required: ['results'],
      },
    };
    const result = convertTool(toolWithOutput, 'mcp');
    const mcpTool = result.tool as MCPToolDefinition;
    expect(mcpTool.inputSchema).toBeDefined();
    expect(mcpTool.outputSchema).toBeDefined();
  });

  it('converts multiple tools for all providers', () => {
    const tools = [
      tool,
      {
        name: 'get_time',
        description: 'Get current time',
        schema: {
          type: 'object' as const,
          properties: {
            timezone: { type: 'string' as const },
          },
          required: ['timezone'],
        },
      },
    ];

    for (const provider of ALL_PROVIDERS) {
      const result = convertTools(tools, provider);
      expect(result.tools.length).toBeGreaterThan(0);
      expect(result.transformations.length).toBe(2);
    }
  });
});

describe('integration: normalize function', () => {
  it('normalizes draft-07 schema to canonical form', () => {
    const draft07: JSONSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      definitions: {
        Address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
          },
        },
      },
      properties: {
        address: { $ref: '#/definitions/Address' },
      },
    };
    const result = normalize(draft07);
    expect(result.$schema).toBeUndefined();
    expect(result.$defs).toBeDefined();
    expect(result.definitions).toBeUndefined();
  });
});

describe('integration: resolveRefs function', () => {
  it('resolves and inlines all refs', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        a: { $ref: '#/$defs/TypeA' },
        b: { $ref: '#/$defs/TypeB' },
      },
      $defs: {
        TypeA: { type: 'string' },
        TypeB: { type: 'number' },
      },
    };
    const { schema: result } = resolveRefs(schema);
    expect(result.properties!.a.type).toBe('string');
    expect(result.properties!.b.type).toBe('number');
    expect(result.$defs).toBeUndefined();
  });
});

describe('integration: edge cases', () => {
  it('handles schema with no properties', () => {
    const schema: JSONSchema = { type: 'object' };
    for (const provider of ALL_PROVIDERS) {
      const result = convert(schema, provider);
      expect(result.schema.type).toBe('object');
    }
  });

  it('handles schema with const', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        version: { const: 'v1' },
      },
      required: ['version'],
    };
    for (const provider of ALL_PROVIDERS) {
      const result = convert(schema, provider);
      expect(result.schema.properties!.version.const).toBe('v1');
    }
  });

  it('handles schema with boolean type array', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        value: { type: ['string', 'number'] },
      },
      required: ['value'],
    };
    for (const provider of ALL_PROVIDERS) {
      const result = convert(schema, provider);
      expect(result.schema.properties!.value.type).toBeDefined();
    }
  });

  it('handles schema with nested arrays', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        matrix: {
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'number' },
          },
        },
      },
      required: ['matrix'],
    };
    for (const provider of ALL_PROVIDERS) {
      const result = convert(schema, provider);
      expect(result.schema.properties!.matrix.type).toBe('array');
    }
  });

  it('handles schema with description only', () => {
    const schema: JSONSchema = {
      type: 'object',
      description: 'A test schema',
      properties: {
        x: { type: 'string', description: 'A field' },
      },
      required: ['x'],
    };
    for (const provider of ALL_PROVIDERS) {
      const result = convert(schema, provider);
      expect(result.schema.description).toBe('A test schema');
    }
  });

  it('handles schema with title', () => {
    const schema: JSONSchema = {
      type: 'object',
      title: 'TestSchema',
      properties: {
        x: { type: 'string', title: 'Field X' },
      },
      required: ['x'],
    };
    for (const provider of ALL_PROVIDERS) {
      const result = convert(schema, provider);
      expect(result.schema.title).toBe('TestSchema');
      expect(result.schema.properties!.x.title).toBe('Field X');
    }
  });

  it('handles schema with multiple constraint types', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        age: {
          type: 'number',
          minimum: 0,
          maximum: 150,
          exclusiveMinimum: -1,
          exclusiveMaximum: 200,
          multipleOf: 1,
          description: 'Age',
          default: 25,
        },
      },
      required: ['age'],
    };
    const openaiResult = convert(schema, 'openai');
    expect(openaiResult.schema.properties!.age.minimum).toBeUndefined();
    expect(openaiResult.schema.properties!.age.maximum).toBeUndefined();
    expect(openaiResult.schema.properties!.age.exclusiveMinimum).toBeUndefined();
    expect(openaiResult.schema.properties!.age.exclusiveMaximum).toBeUndefined();
    expect(openaiResult.schema.properties!.age.multipleOf).toBeUndefined();
    expect(openaiResult.schema.properties!.age.default).toBeUndefined();
    expect(openaiResult.schema.properties!.age.description).toBe('Age');

    const mcpResult = convert(schema, 'mcp');
    expect(mcpResult.schema.properties!.age.minimum).toBe(0);
    expect(mcpResult.schema.properties!.age.maximum).toBe(150);
    expect(mcpResult.schema.properties!.age.multipleOf).toBe(1);
    expect(mcpResult.schema.properties!.age.default).toBe(25);
  });
});

describe('integration: promoteConstraintsToDescription', () => {
  it('promotes constraints for OpenAI when enabled', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        score: {
          type: 'number',
          description: 'User score',
          minimum: 0,
          maximum: 100,
        },
      },
      required: ['score'],
    };
    const result = convert(schema, 'openai', { promoteConstraintsToDescription: true });
    const desc = result.schema.properties!.score.description!;
    expect(desc).toContain('User score');
    expect(desc).toContain('minimum');
    expect(desc).toContain('maximum');
  });

  it('creates description from constraints when none exists', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        value: { type: 'number', minimum: 1 },
      },
      required: ['value'],
    };
    const result = convert(schema, 'openai', { promoteConstraintsToDescription: true });
    expect(result.schema.properties!.value.description).toContain('minimum');
  });
});
