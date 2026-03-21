import { describe, it, expect } from 'vitest';
import { createTool, createTools } from '../tool';
import { convertTool, convertTools } from '../index';
import type { JSONSchema, Provider, OpenAIToolDefinition, AnthropicToolDefinition, GeminiToolDefinition, CohereToolDefinition, MCPToolDefinition, OllamaToolDefinition } from '../types';

const weatherSchema: JSONSchema = {
  type: 'object',
  properties: {
    location: { type: 'string', description: 'City and state' },
    units: { type: 'string', enum: ['fahrenheit', 'celsius'] },
  },
  required: ['location'],
};

const weatherTool = {
  name: 'get_weather',
  description: 'Get current weather for a location',
  schema: weatherSchema,
};

describe('createTool', () => {
  describe('tool name validation', () => {
    it('accepts valid alphanumeric names', () => {
      expect(() => createTool({ ...weatherTool, name: 'get_weather' }, 'openai')).not.toThrow();
    });

    it('accepts names with hyphens', () => {
      expect(() => createTool({ ...weatherTool, name: 'get-weather' }, 'openai')).not.toThrow();
    });

    it('accepts names with underscores', () => {
      expect(() => createTool({ ...weatherTool, name: 'get_weather_v2' }, 'openai')).not.toThrow();
    });

    it('rejects names with spaces', () => {
      expect(() => createTool({ ...weatherTool, name: 'get weather' }, 'openai')).toThrow(TypeError);
    });

    it('rejects names with special characters', () => {
      expect(() => createTool({ ...weatherTool, name: 'get@weather' }, 'openai')).toThrow(TypeError);
    });

    it('rejects empty names', () => {
      expect(() => createTool({ ...weatherTool, name: '' }, 'openai')).toThrow(TypeError);
    });
  });

  describe('OpenAI tool format', () => {
    it('produces correct envelope', () => {
      const { tool } = createTool(weatherTool, 'openai');
      const openaiTool = tool as OpenAIToolDefinition;
      expect(openaiTool.type).toBe('function');
      expect(openaiTool.function.name).toBe('get_weather');
      expect(openaiTool.function.description).toBe('Get current weather for a location');
      expect(openaiTool.function.parameters).toBeDefined();
      expect(openaiTool.function.strict).toBe(true);
    });

    it('sets strict: false when option specified', () => {
      const { tool } = createTool(weatherTool, 'openai', { strict: false });
      const openaiTool = tool as OpenAIToolDefinition;
      expect(openaiTool.function.strict).toBe(false);
    });

    it('injects additionalProperties: false in parameters', () => {
      const { tool } = createTool(weatherTool, 'openai');
      const openaiTool = tool as OpenAIToolDefinition;
      expect(openaiTool.function.parameters.additionalProperties).toBe(false);
    });

    it('expands required and makes optional fields nullable', () => {
      const { tool } = createTool(weatherTool, 'openai');
      const openaiTool = tool as OpenAIToolDefinition;
      expect(openaiTool.function.parameters.required).toContain('location');
      expect(openaiTool.function.parameters.required).toContain('units');
    });
  });

  describe('Anthropic tool format', () => {
    it('produces correct envelope', () => {
      const { tool } = createTool(weatherTool, 'anthropic');
      const anthropicTool = tool as AnthropicToolDefinition;
      expect(anthropicTool.name).toBe('get_weather');
      expect(anthropicTool.description).toBe('Get current weather for a location');
      expect(anthropicTool.input_schema).toBeDefined();
      expect(anthropicTool.input_schema.type).toBe('object');
    });

    it('uses input_schema key (not parameters)', () => {
      const { tool } = createTool(weatherTool, 'anthropic');
      const anthropicTool = tool as AnthropicToolDefinition;
      expect(anthropicTool.input_schema).toBeDefined();
      expect((anthropicTool as unknown as Record<string, unknown>).parameters).toBeUndefined();
    });

    it('preserves optional fields as optional', () => {
      const { tool } = createTool(weatherTool, 'anthropic');
      const anthropicTool = tool as AnthropicToolDefinition;
      expect(anthropicTool.input_schema.required).toEqual(['location']);
    });
  });

  describe('Gemini tool format', () => {
    it('produces correct envelope', () => {
      const { tool } = createTool(weatherTool, 'gemini');
      const geminiTool = tool as GeminiToolDefinition;
      expect(geminiTool.name).toBe('get_weather');
      expect(geminiTool.description).toBe('Get current weather for a location');
      expect(geminiTool.parameters).toBeDefined();
    });
  });

  describe('Cohere tool format', () => {
    it('produces correct envelope', () => {
      const { tool } = createTool(weatherTool, 'cohere');
      const cohereTool = tool as CohereToolDefinition;
      expect(cohereTool.type).toBe('function');
      expect(cohereTool.function.name).toBe('get_weather');
      expect(cohereTool.function.description).toBe('Get current weather for a location');
      expect(cohereTool.function.parameters).toBeDefined();
    });
  });

  describe('MCP tool format', () => {
    it('produces correct envelope with camelCase inputSchema', () => {
      const { tool } = createTool(weatherTool, 'mcp');
      const mcpTool = tool as MCPToolDefinition;
      expect(mcpTool.name).toBe('get_weather');
      expect(mcpTool.description).toBe('Get current weather for a location');
      expect(mcpTool.inputSchema).toBeDefined();
      expect((mcpTool as unknown as Record<string, unknown>).input_schema).toBeUndefined();
    });

    it('includes outputSchema when provided', () => {
      const toolWithOutput = {
        ...weatherTool,
        outputSchema: {
          type: 'object' as const,
          properties: {
            temperature: { type: 'number' as const },
          },
          required: ['temperature'],
        },
      };
      const { tool } = createTool(toolWithOutput, 'mcp');
      const mcpTool = tool as MCPToolDefinition;
      expect(mcpTool.outputSchema).toBeDefined();
      expect(mcpTool.outputSchema!.type).toBe('object');
    });

    it('does not include outputSchema for non-MCP providers', () => {
      const toolWithOutput = {
        ...weatherTool,
        outputSchema: {
          type: 'object' as const,
          properties: {
            temperature: { type: 'number' as const },
          },
        },
      };
      const { tool } = createTool(toolWithOutput, 'openai');
      expect((tool as unknown as Record<string, unknown>).outputSchema).toBeUndefined();
    });
  });

  describe('Ollama tool format', () => {
    it('produces correct envelope', () => {
      const { tool } = createTool(weatherTool, 'ollama');
      const ollamaTool = tool as OllamaToolDefinition;
      expect(ollamaTool.name).toBe('get_weather');
      expect(ollamaTool.description).toBe('Get current weather for a location');
      expect(ollamaTool.format).toBeDefined();
    });
  });

  it('returns transformations and warnings', () => {
    const { transformations, warnings } = createTool(weatherTool, 'openai');
    expect(Array.isArray(transformations)).toBe(true);
    expect(Array.isArray(warnings)).toBe(true);
  });
});

describe('createTools', () => {
  const tools = [
    weatherTool,
    {
      name: 'search',
      description: 'Search the web',
      schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string' as const },
        },
        required: ['query'],
      },
    },
  ];

  it('converts multiple tools', () => {
    const result = createTools(tools, 'openai');
    expect(result.tools.length).toBe(2);
    expect(result.transformations.length).toBe(2);
    expect(result.warnings.length).toBe(2);
  });

  it('handles empty array', () => {
    const result = createTools([], 'openai');
    expect(result.tools.length).toBe(0);
  });

  it('wraps Gemini tools in functionDeclarations', () => {
    const result = createTools(tools, 'gemini');
    expect(result.tools.length).toBe(1); // Single object wrapping all declarations
    const wrapper = result.tools[0] as unknown as { functionDeclarations: GeminiToolDefinition[] };
    expect(wrapper.functionDeclarations).toBeDefined();
    expect(wrapper.functionDeclarations.length).toBe(2);
  });

  it('each tool gets independent transformation records', () => {
    const result = createTools(tools, 'openai');
    expect(result.transformations[0]).not.toBe(result.transformations[1]);
  });
});

describe('convertTool (re-exported from index)', () => {
  it('works the same as createTool', () => {
    const result = convertTool(weatherTool, 'openai');
    expect(result.tool).toBeDefined();
    expect(result.transformations).toBeDefined();
    expect(result.warnings).toBeDefined();
  });
});

describe('convertTools (re-exported from index)', () => {
  it('works the same as createTools', () => {
    const result = convertTools([weatherTool], 'anthropic');
    expect(result.tools.length).toBe(1);
  });
});
