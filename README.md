# schema-bridge

Convert JSON Schema to provider-specific structured output configurations for OpenAI, Anthropic, Gemini, Cohere, MCP, Ollama, and Vercel AI SDK.

## Installation

```bash
npm install schema-bridge
```

## Quick Start

```typescript
import { convert, convertTool, supported } from 'schema-bridge';

// Define your schema once
const schema = {
  type: 'object',
  properties: {
    temperature: { type: 'number', description: 'Temperature in Fahrenheit' },
    conditions: { type: 'string', description: 'Weather conditions' },
    humidity: { type: 'number', description: 'Humidity percentage' },
  },
  required: ['temperature', 'conditions'],
};

// Convert for any provider
const openai = convert(schema, 'openai');
const anthropic = convert(schema, 'anthropic');
const gemini = convert(schema, 'gemini');
```

## API

### `convert(schema, provider, options?)`

Converts a JSON Schema to a provider-specific format.

```typescript
const result = convert(schema, 'openai');
// result.schema - the converted schema
// result.transformations - list of changes applied
// result.warnings - lossy conversion warnings
```

**Providers:** `'openai'`, `'anthropic'`, `'gemini'`, `'cohere'`, `'mcp'`, `'ollama'`, `'vercel-ai'`

**Options:**
- `strict` (boolean) - Enable strict mode (default: `true` for OpenAI)
- `name` (string) - Schema name for OpenAI response_format
- `description` (string) - Schema description
- `promoteConstraintsToDescription` (boolean) - Append removed constraints to description fields
- `maxRecursionDepth` (number) - Max depth for recursive $ref inlining (default: 5)

### `convertTool(tool, provider, options?)`

Converts a tool definition to a provider-specific format.

```typescript
const result = convertTool(
  {
    name: 'get_weather',
    description: 'Get current weather',
    schema: weatherSchema,
  },
  'openai',
);
// result.tool - provider-specific tool definition
```

Each provider uses its own envelope format:
- **OpenAI:** `{ type: "function", function: { name, description, parameters, strict } }`
- **Anthropic:** `{ name, description, input_schema }`
- **Gemini:** `{ name, description, parameters }`
- **Cohere:** `{ type: "function", function: { name, description, parameters } }`
- **MCP:** `{ name, description, inputSchema, outputSchema? }`
- **Ollama:** `{ name, description, format }`

### `convertTools(tools, provider, options?)`

Batch-converts multiple tool definitions. For Gemini, wraps all tools in a single `functionDeclarations` object.

### `normalize(schema)`

Normalizes a JSON Schema to canonical form (draft-2020-12 style):
- Converts `definitions` to `$defs`
- Converts array-form `items` to `prefixItems`
- Strips `$schema`

### `resolveRefs(schema, options?)`

Resolves `$ref` references by inlining them.

### `supported()`

Returns an array of all supported provider names.

## Provider-Specific Behavior

### OpenAI (strict mode)

- Injects `additionalProperties: false` on all objects
- Expands `required` to include all properties; optional fields become nullable
- Removes unsupported keywords: `minimum`, `maximum`, `pattern`, `format`, `default`, `examples`, `minLength`, `maxLength`, `minItems`, `maxItems`, `multipleOf`, `exclusiveMinimum`, `exclusiveMaximum`, `$comment`
- Simplifies `allOf` (merges), converts `oneOf` to `anyOf`, removes `not`

### Anthropic

- Minimal transformation (removes `$comment` only)
- Preserves all constraints, `$ref`, `anyOf`/`oneOf`/`allOf`
- Optional fields remain truly optional
- Strict mode (`strict: true`) injects `additionalProperties: false`

### Gemini

- Removes `default`, `examples`, `$comment`
- Preserves constraints and `$ref`
- Merges `allOf`, removes `not`

### MCP

- No keyword removal (full JSON Schema support)
- Supports `outputSchema` on tool definitions

### Cohere

- Removes `$comment`
- Preserves all other keywords

### Ollama

- Removes `examples`, `$comment`
- Schema passed directly as `format` field value

## License

MIT
