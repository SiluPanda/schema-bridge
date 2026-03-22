# schema-bridge

Write your JSON Schema once. Deploy it to every LLM provider.

[![npm version](https://img.shields.io/npm/v/schema-bridge.svg)](https://www.npmjs.com/package/schema-bridge)
[![license](https://img.shields.io/npm/l/schema-bridge.svg)](https://github.com/SiluPanda/schema-bridge/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/schema-bridge.svg)](https://nodejs.org)

---

## Description

`schema-bridge` converts a single JSON Schema definition into provider-specific structured output configurations for **OpenAI**, **Anthropic**, **Google Gemini**, **Cohere**, **MCP**, **Ollama**, and **Vercel AI SDK**. Each LLM provider imposes different structural requirements, keyword restrictions, and wrapper formats on schemas used for structured output and tool definitions. `schema-bridge` handles every provider's quirks automatically so you can define your schema once and use it everywhere.

Every major LLM provider accepts JSON Schema to define structured output or tool parameters, but no two providers accept the same subset. OpenAI strict mode requires `additionalProperties: false` on every object and rejects keywords like `minimum`, `maximum`, and `format`. Anthropic wraps tool schemas in an `input_schema` key. Gemini uses `responseSchema` inside `generationConfig` and does not support `default`. MCP uses `inputSchema` with full JSON Schema support. Getting these conversions wrong results in hard 400 errors, not subtle bugs. `schema-bridge` eliminates this problem entirely.

The package has **zero runtime dependencies**. It accepts JSON Schema objects (draft-07, draft-2020-12) as input, normalizes them to a canonical internal representation, applies provider-specific transformations, and returns the result in the exact shape the provider's API expects. A `TransformationRecord` array documents every change made and flags lossy conversions.

---

## Installation

```bash
npm install schema-bridge
```

**Requirements:** Node.js >= 18

---

## Quick Start

```typescript
import { convert, convertTool, convertTools } from 'schema-bridge';

// Define your schema once
const schema = {
  type: 'object',
  properties: {
    temperature: { type: 'number', description: 'Temperature in Fahrenheit' },
    conditions: { type: 'string', description: 'Weather conditions' },
    humidity: { type: 'number', description: 'Humidity percentage', minimum: 0, maximum: 100 },
  },
  required: ['temperature', 'conditions'],
};

// Convert for any provider
const openaiResult = convert(schema, 'openai');
// openaiResult.schema has additionalProperties: false injected,
// all properties required, optional fields made nullable,
// and unsupported keywords (minimum, maximum) removed.

const anthropicResult = convert(schema, 'anthropic');
// anthropicResult.schema preserves minimum, maximum, and optional fields as-is.

const mcpResult = convert(schema, 'mcp');
// mcpResult.schema passes through unchanged (MCP supports full JSON Schema).

// Convert a tool definition for a specific provider
const toolResult = convertTool(
  {
    name: 'get_weather',
    description: 'Get current weather for a location',
    schema,
  },
  'openai',
);
// toolResult.tool is ready to pass directly to the OpenAI SDK:
// { type: "function", function: { name, description, parameters, strict } }
```

---

## Features

- **Seven providers supported** -- OpenAI, Anthropic, Gemini, Cohere, MCP, Ollama, and Vercel AI SDK, each with its own provider adapter that encodes the provider's exact schema requirements.
- **Automatic `additionalProperties: false` injection** -- for OpenAI strict mode and Anthropic strict mode, applied recursively to every nested object.
- **Required field expansion** -- for OpenAI strict mode, all properties are added to the `required` array and optional fields are converted to nullable types.
- **Unsupported keyword removal** -- keywords like `minimum`, `maximum`, `format`, `pattern`, `default`, and `examples` are stripped per provider, with each removal recorded as a transformation.
- **Composition simplification** -- `allOf` schemas are merged into a single schema, `oneOf` is converted to `anyOf`, and `not` is removed for providers with limited support.
- **`$ref` resolution** -- `$ref` references are inlined for providers that require it, with recursive schema detection and configurable truncation depth.
- **Recursive schema handling** -- recursive `$ref` cycles are detected automatically and either preserved (for providers that support `$ref`/`$defs`) or truncated with a lossy transformation warning.
- **Transformation reports** -- every conversion returns a `TransformationRecord[]` documenting each change (path, type, message, lossiness) and a `warnings` array for lossy conversions.
- **Constraint promotion** -- optionally appends removed constraints to `description` fields so the LLM still sees them as natural language hints.
- **Tool definition conversion** -- `convertTool` and `convertTools` produce provider-specific tool envelopes ready to pass directly to each provider's SDK.
- **Schema normalization** -- `normalize` converts draft-07 schemas to canonical draft-2020-12 form (`definitions` to `$defs`, array-form `items` to `prefixItems`, `$schema` stripped).
- **Zero runtime dependencies** -- the core conversion logic has no external dependencies.
- **Immutable input** -- the original schema is never mutated; all transformations operate on deep clones.

---

## API Reference

### `convert(schema, provider, options?)`

Convert a JSON Schema to a provider-specific structured output format.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `schema` | `JSONSchema` | A JSON Schema object. |
| `provider` | `Provider` | Target provider: `'openai'`, `'anthropic'`, `'gemini'`, `'cohere'`, `'mcp'`, `'ollama'`, or `'vercel-ai'`. |
| `options` | `ConvertOptions` | Optional. Conversion options (see below). |

**Returns:** `ProviderSchema`

```typescript
interface ProviderSchema {
  schema: JSONSchema;               // The transformed schema
  transformations: TransformationRecord[];  // Every change applied
  warnings: string[];               // Lossy conversion warnings
}
```

**Example:**

```typescript
import { convert } from 'schema-bridge';

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    age: { type: 'number', minimum: 0 },
  },
  required: ['name'],
};

const result = convert(schema, 'openai');
console.log(result.schema);
// {
//   type: 'object',
//   properties: {
//     name: { type: 'string' },
//     age: { type: ['number', 'null'] },
//   },
//   required: ['name', 'age'],
//   additionalProperties: false,
// }

console.log(result.warnings);
// ['Removed "minLength" at ...', 'Removed "minimum" at ...']
```

---

### `convertTool(tool, provider, options?)`

Convert a tool definition to a provider-specific tool object.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tool` | `ToolDefinitionInput` | Tool definition with `name`, `description`, `schema`, and optional `outputSchema`. |
| `provider` | `Provider` | Target provider name. |
| `options` | `ConvertOptions` | Optional. Conversion options. |

**Returns:** `{ tool: ToolDefinition; transformations: TransformationRecord[]; warnings: string[] }`

Each provider uses its own envelope format:

| Provider | Envelope Shape |
|----------|---------------|
| OpenAI | `{ type: "function", function: { name, description, parameters, strict } }` |
| Anthropic | `{ name, description, input_schema }` |
| Gemini | `{ name, description, parameters }` |
| Cohere | `{ type: "function", function: { name, description, parameters } }` |
| MCP | `{ name, description, inputSchema, outputSchema? }` |
| Ollama | `{ name, description, format }` |
| Vercel AI | `{ name, description, parameters }` |

**Example:**

```typescript
import { convertTool } from 'schema-bridge';

const { tool } = convertTool(
  {
    name: 'search_web',
    description: 'Search the web for information',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', minimum: 1, maximum: 100 },
      },
      required: ['query'],
    },
  },
  'anthropic',
);

// tool is ready to pass to the Anthropic SDK:
// {
//   name: 'search_web',
//   description: 'Search the web for information',
//   input_schema: { type: 'object', properties: { ... }, required: ['query'] }
// }
```

---

### `convertTools(tools, provider, options?)`

Batch-convert multiple tool definitions to a provider-specific format.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tools` | `ToolDefinitionInput[]` | Array of tool definitions. |
| `provider` | `Provider` | Target provider name. |
| `options` | `ConvertOptions` | Optional. Conversion options. |

**Returns:** `{ tools: ToolDefinition[]; transformations: TransformationRecord[][]; warnings: string[][] }`

For Gemini, all tools are wrapped in a single `{ functionDeclarations: [...] }` object, matching Gemini's expected format.

**Example:**

```typescript
import { convertTools } from 'schema-bridge';

const tools = [
  { name: 'get_weather', description: 'Get weather', schema: weatherSchema },
  { name: 'search_web', description: 'Search the web', schema: searchSchema },
];

const result = convertTools(tools, 'gemini');
// result.tools is a single-element array:
// [{ functionDeclarations: [{ name, description, parameters }, { name, description, parameters }] }]
```

---

### `normalize(schema)`

Normalize a JSON Schema to canonical draft-2020-12 form. This is called internally by `convert`, but is also exported for direct use.

**Normalization steps:**

- Converts `definitions` to `$defs`
- Converts array-form `items` to `prefixItems`
- Strips the `$schema` property
- Recurses into all subschemas (`properties`, `items`, `anyOf`, `oneOf`, `allOf`, `not`, `additionalProperties`, `$defs`)

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `schema` | `JSONSchema` | A JSON Schema object. |

**Returns:** `JSONSchema` -- a new normalized schema object (the input is not mutated).

```typescript
import { normalize } from 'schema-bridge';

const draft07 = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  definitions: {
    Address: { type: 'object', properties: { street: { type: 'string' } } },
  },
};

const normalized = normalize(draft07);
// normalized.$schema is undefined
// normalized.$defs.Address exists
// normalized.definitions is undefined
```

---

### `resolveRefs(schema, options?)`

Resolve all `$ref` references by inlining them. This is called internally by `convert`, but is also exported for direct use.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `schema` | `JSONSchema` | A JSON Schema object (should be normalized first). |
| `options.maxRecursionDepth` | `number` | Maximum depth for recursive `$ref` inlining (default: `5`). |
| `options.preserveRefs` | `boolean` | If `true`, keep recursive `$ref` and `$defs` intact instead of inlining. |

**Returns:** `{ schema: JSONSchema; transformations: TransformationRecord[] }`

```typescript
import { resolveRefs } from 'schema-bridge';

const schema = {
  type: 'object',
  properties: { address: { $ref: '#/$defs/Address' } },
  $defs: { Address: { type: 'object', properties: { city: { type: 'string' } } } },
};

const { schema: resolved, transformations } = resolveRefs(schema);
// resolved.properties.address.type === 'object'
// resolved.properties.address.properties.city.type === 'string'
// resolved.$defs is undefined (all refs inlined)
```

---

### `supported()`

List all supported provider names.

**Returns:** `Provider[]` -- `['openai', 'anthropic', 'gemini', 'cohere', 'mcp', 'vercel-ai', 'ollama']`

```typescript
import { supported } from 'schema-bridge';

console.log(supported());
// ['openai', 'anthropic', 'gemini', 'cohere', 'mcp', 'vercel-ai', 'ollama']
```

---

### Provider-Specific Converters

For advanced use cases, individual provider converters are exported directly:

```typescript
import {
  convertToOpenAI,
  convertToAnthropic,
  convertToGemini,
  convertToCohere,
  convertToMCP,
  convertToOllama,
  wrapOpenAIResponseFormat,
  wrapGeminiResponseFormat,
} from 'schema-bridge';
```

#### `convertToOpenAI(schema, options?)`

Applies OpenAI strict mode transformations to a JSON Schema. Returns `ProviderSchema`.

#### `convertToAnthropic(schema, options?)`

Applies Anthropic transformations (removes `$comment`; optional `additionalProperties: false` in strict mode). Returns `ProviderSchema`.

#### `convertToGemini(schema, options?)`

Applies Gemini transformations (removes `default`, `examples`, `$comment`; simplifies composition). Returns `ProviderSchema`.

#### `convertToCohere(schema, options?)`

Applies Cohere transformations (removes `$comment`). Returns `ProviderSchema`.

#### `convertToMCP(schema, options?)`

Passes through with no modifications (MCP supports full JSON Schema). Returns `ProviderSchema`.

#### `convertToOllama(schema, options?)`

Applies Ollama transformations (removes `examples`, `$comment`). Returns `ProviderSchema`.

#### `wrapOpenAIResponseFormat(schema, name, strict?)`

Wraps a converted schema in OpenAI's `response_format` envelope.

```typescript
import { convertToOpenAI, wrapOpenAIResponseFormat } from 'schema-bridge';

const { schema } = convertToOpenAI(mySchema);
const responseFormat = wrapOpenAIResponseFormat(schema, 'my_response', true);
// {
//   type: 'json_schema',
//   json_schema: { name: 'my_response', schema: { ... }, strict: true }
// }
```

#### `wrapGeminiResponseFormat(schema)`

Wraps a converted schema in Gemini's `generationConfig` envelope.

```typescript
import { convertToGemini, wrapGeminiResponseFormat } from 'schema-bridge';

const { schema } = convertToGemini(mySchema);
const config = wrapGeminiResponseFormat(schema);
// {
//   generationConfig: { responseMimeType: 'application/json', responseSchema: { ... } }
// }
```

---

### Tool Builder Functions

The underlying tool builder functions are also exported:

```typescript
import { createTool, createTools } from 'schema-bridge';
```

`createTool` and `createTools` are identical to `convertTool` and `convertTools`. Both pairs are available for naming preference.

---

## Configuration

### `ConvertOptions`

All conversion functions accept an optional `ConvertOptions` object:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `strict` | `boolean` | `true` for OpenAI, `false` for Anthropic | Enable strict mode. For OpenAI, injects `additionalProperties: false`, expands `required`, and removes unsupported keywords. For Anthropic, injects `additionalProperties: false` only. |
| `name` | `string` | `undefined` | Schema name, used in the OpenAI `response_format` envelope. |
| `description` | `string` | `undefined` | Schema description. |
| `promoteConstraintsToDescription` | `boolean` | `false` | When a keyword is removed (e.g., `minimum: 0` for OpenAI), append it to the field's `description` so the LLM still sees the constraint as a natural language hint. |
| `maxRecursionDepth` | `number` | `5` | Maximum depth for inlining recursive `$ref` references. Beyond this depth, recursive refs are truncated to `{ type: 'object' }` with a lossy transformation warning. |

```typescript
const result = convert(schema, 'openai', {
  strict: true,
  promoteConstraintsToDescription: true,
  maxRecursionDepth: 3,
});
```

---

## Error Handling

### Unsupported Provider

Passing a provider name that is not recognized throws an `Error`:

```typescript
convert(schema, 'unknown-provider');
// Error: Unsupported provider: "unknown-provider". Supported providers: openai, anthropic, gemini, cohere, mcp, vercel-ai, ollama
```

### Invalid Tool Name

Tool names must match `^[a-zA-Z0-9_-]+$`. Invalid names throw a `TypeError`:

```typescript
convertTool({ name: 'get weather', description: '...', schema }, 'openai');
// TypeError: Invalid tool name "get weather": must contain only alphanumeric characters, underscores, and hyphens
```

### Lossy Transformations

When a schema feature cannot be represented in the target provider, `schema-bridge` does not throw. Instead, it applies the transformation, marks it as `lossy: true` in the `TransformationRecord`, and adds a human-readable message to the `warnings` array. This allows you to audit exactly what was lost:

```typescript
const result = convert(
  {
    type: 'object',
    properties: {
      score: { type: 'number', minimum: 0, maximum: 100 },
    },
    required: ['score'],
  },
  'openai',
);

for (const t of result.transformations.filter(t => t.lossy)) {
  console.log(`${t.path}: ${t.message}`);
}
// $.properties.score: Removed unsupported keyword "minimum" (value: 0)
// $.properties.score: Removed unsupported keyword "maximum" (value: 100)
```

### Recursive Schema Truncation

Recursive schemas that exceed `maxRecursionDepth` are truncated to `{ type: 'object' }` for providers that do not support `$ref`/`$defs`. This produces a `RECURSIVE_SCHEMA_TRUNCATED` transformation record with `lossy: true`.

---

## Advanced Usage

### Multi-Provider Tool Deployment

Convert a set of tools for whichever provider the user selects at runtime:

```typescript
import { convertTools } from 'schema-bridge';
import type { Provider } from 'schema-bridge';

const tools = [
  {
    name: 'get_weather',
    description: 'Get current weather',
    schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  },
  {
    name: 'search_docs',
    description: 'Search documentation',
    schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
];

function getProviderTools(provider: Provider) {
  return convertTools(tools, provider);
}

// At runtime, use whichever provider the user configured
const { tools: openaiTools } = getProviderTools('openai');
const { tools: anthropicTools } = getProviderTools('anthropic');
```

### MCP Server with Output Schema

MCP is the only provider that supports `outputSchema` on tool definitions:

```typescript
import { convertTool } from 'schema-bridge';

const { tool } = convertTool(
  {
    name: 'calculate',
    description: 'Perform a calculation',
    schema: {
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression'],
    },
    outputSchema: {
      type: 'object',
      properties: { result: { type: 'number' } },
      required: ['result'],
    },
  },
  'mcp',
);

// tool.inputSchema and tool.outputSchema are both present
```

### Promoting Constraints to Descriptions

When converting for providers that strip validation keywords, you can preserve them as natural language hints in the `description` field:

```typescript
import { convert } from 'schema-bridge';

const result = convert(
  {
    type: 'object',
    properties: {
      age: { type: 'number', description: 'User age', minimum: 0, maximum: 150 },
    },
    required: ['age'],
  },
  'openai',
  { promoteConstraintsToDescription: true },
);

console.log(result.schema.properties.age.description);
// "User age (minimum: 0) (maximum: 150)"
```

### OpenAI Response Format Envelope

Use `wrapOpenAIResponseFormat` to produce the complete `response_format` object for OpenAI's structured output API:

```typescript
import { convert, wrapOpenAIResponseFormat } from 'schema-bridge';

const { schema } = convert(mySchema, 'openai');
const responseFormat = wrapOpenAIResponseFormat(schema, 'extract_data');

// Pass directly to the OpenAI SDK:
// openai.chat.completions.create({ ..., response_format: responseFormat })
```

### Gemini Generation Config Envelope

Use `wrapGeminiResponseFormat` to produce the `generationConfig` object for Gemini's structured output:

```typescript
import { convert, wrapGeminiResponseFormat } from 'schema-bridge';

const { schema } = convert(mySchema, 'gemini');
const config = wrapGeminiResponseFormat(schema);

// config.generationConfig.responseMimeType === 'application/json'
// config.generationConfig.responseSchema === schema
```

### Inspecting Transformation Reports

Every conversion returns a full audit trail:

```typescript
import { convert } from 'schema-bridge';

const result = convert(complexSchema, 'openai');

for (const t of result.transformations) {
  console.log(`[${t.type}] ${t.path}: ${t.message} (lossy: ${t.lossy})`);
}
// [ADDITIONAL_PROPERTIES_INJECTED] $: Set additionalProperties to false (was undefined) (lossy: false)
// [REQUIRED_EXPANDED] $.properties.nickname: Added "nickname" to required array and made nullable (lossy: false)
// [KEYWORD_REMOVED] $.properties.age: Removed unsupported keyword "minimum" (value: 0) (lossy: true)
// ...
```

**Transformation types:**

| Type | Description |
|------|-------------|
| `REF_INLINED` | A `$ref` was replaced with the referenced schema definition. |
| `ADDITIONAL_PROPERTIES_INJECTED` | `additionalProperties: false` was set on an object. |
| `REQUIRED_EXPANDED` | A property was added to the `required` array and made nullable. |
| `FIELD_MADE_NULLABLE` | A field's type was changed to include `null`. |
| `KEYWORD_REMOVED` | An unsupported keyword was removed from the schema. |
| `COMPOSITION_SIMPLIFIED` | An `allOf` was merged, `oneOf` converted to `anyOf`, or `not` removed. |
| `DEFAULT_REMOVED` | A `default` value was removed. |
| `RECURSIVE_SCHEMA_TRUNCATED` | A recursive `$ref` was truncated at the configured depth limit. |

---

## Provider-Specific Behavior

### OpenAI (strict mode, default)

| Transformation | Detail |
|---------------|--------|
| `additionalProperties: false` | Injected on every object at every nesting level. |
| Required expansion | All properties added to `required`; optional fields converted to nullable (`["string", "null"]` or `anyOf` with `{ type: "null" }`). |
| Keyword removal | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minLength`, `maxLength`, `minItems`, `maxItems`, `pattern`, `format`, `default`, `examples`, `$comment` are removed. |
| Composition | `allOf` merged into single schema. `oneOf` converted to `anyOf`. `not` removed (lossy). |
| `$ref` handling | Preserved for recursive schemas; non-recursive refs inlined. |
| Strict: false | When `strict: false`, no transformations are applied. |

### Anthropic

| Transformation | Detail |
|---------------|--------|
| Keyword removal | `$comment` removed. All other keywords preserved. |
| Constraints | `minimum`, `maximum`, `pattern`, `format`, `default` -- all preserved. |
| Optional fields | Remain truly optional (not expanded to required). |
| Strict mode | `strict: true` injects `additionalProperties: false` on all objects. Does not expand `required`. |
| `$ref` handling | Preserved. |
| Composition | `anyOf`, `oneOf`, `allOf` all preserved. |

### Gemini

| Transformation | Detail |
|---------------|--------|
| Keyword removal | `default`, `examples`, `$comment` removed. |
| Constraints | `minimum`, `maximum`, `pattern`, `format` preserved. |
| Composition | `allOf` merged. `not` removed (lossy). `anyOf` and `oneOf` preserved. |
| `$ref` handling | Preserved. |
| `additionalProperties` | Not modified. |

### Cohere

| Transformation | Detail |
|---------------|--------|
| Keyword removal | `$comment` removed. |
| All other keywords | Preserved (constraints, composition, `$ref`). |

### MCP

| Transformation | Detail |
|---------------|--------|
| Keyword removal | None. Full JSON Schema support. |
| `outputSchema` | Supported on tool definitions (unique to MCP). |
| `$ref` handling | Preserved. |

### Ollama

| Transformation | Detail |
|---------------|--------|
| Keyword removal | `examples`, `$comment` removed. |
| All other keywords | Preserved. |
| Schema delivery | Passed directly as the `format` field value. |

### Vercel AI SDK

Uses the same converter as MCP (standard JSON Schema passthrough, no keyword removal).

---

## TypeScript

`schema-bridge` is written in TypeScript and ships with full type declarations. All types are exported from the package root:

```typescript
import type {
  // Core types
  JSONSchema,
  Provider,
  ConvertOptions,
  ProviderSchema,
  TransformationRecord,
  TransformationType,

  // Tool definition types
  ToolDefinitionInput,
  ToolDefinition,
  OpenAIToolDefinition,
  AnthropicToolDefinition,
  GeminiToolDefinition,
  CohereToolDefinition,
  MCPToolDefinition,
  OllamaToolDefinition,
  GenericToolDefinition,
} from 'schema-bridge';
```

### `Provider`

```typescript
type Provider = 'openai' | 'anthropic' | 'gemini' | 'cohere' | 'mcp' | 'vercel-ai' | 'ollama';
```

### `JSONSchema`

A recursive interface supporting draft-07 and draft-2020-12 keywords including `type`, `properties`, `required`, `items`, `prefixItems`, `additionalProperties`, `enum`, `const`, `anyOf`, `oneOf`, `allOf`, `not`, `$ref`, `$defs`, `definitions`, `description`, `title`, `default`, `format`, `pattern`, `minimum`, `maximum`, and more. Includes an index signature for extension keywords.

### `TransformationRecord`

```typescript
interface TransformationRecord {
  type: TransformationType;  // e.g., 'KEYWORD_REMOVED', 'ADDITIONAL_PROPERTIES_INJECTED'
  path: string;              // JSON path, e.g., '$.properties.age'
  message: string;           // Human-readable description
  lossy: boolean;            // Whether the transformation lost information
}
```

### `ToolDefinitionInput`

```typescript
interface ToolDefinitionInput {
  name: string;              // Must match /^[a-zA-Z0-9_-]+$/
  description: string;
  schema: JSONSchema;
  outputSchema?: JSONSchema; // Only used by MCP provider
}
```

---

## License

MIT
