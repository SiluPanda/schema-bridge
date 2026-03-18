# schema-bridge -- Specification

## 1. Overview

`schema-bridge` is a schema conversion library that takes a single schema definition -- written in Zod, JSON Schema, or TypeBox -- and produces provider-specific structured output configurations for OpenAI, Anthropic, Google Gemini, Cohere, MCP, Vercel AI SDK, Ollama, and other LLM providers. Each provider has different structural requirements, keyword restrictions, and wrapper formats for schemas used in structured output and tool definitions. `schema-bridge` handles every provider's quirks automatically so that developers write their schema once and deploy it everywhere without manually adapting it per provider.

The gap this package fills is specific and well-documented. Every major LLM provider accepts JSON Schema to define structured output or tool parameters, but no two providers accept the same JSON Schema. OpenAI's strict mode requires `additionalProperties: false` on every object, demands that all properties appear in the `required` array (with optional fields represented as nullable types instead), supports `$ref`/`$defs` only for recursive references at the top level, and rejects keywords like `minimum`, `maximum`, and `format`. Anthropic wraps tool schemas in an `input_schema` key, supports broader JSON Schema but has its own structured output beta with `additionalProperties: false` requirements. Google Gemini uses `responseSchema` inside `generationConfig`, historically lacked support for `$ref`, `anyOf`, and `oneOf` (though recent updates have expanded support), enforces property ordering, and uses OpenAPI-compatible schema syntax with uppercase type constants in some SDK versions. MCP uses standard JSON Schema for `inputSchema` and `outputSchema` with minimal restrictions. Cohere uses a `parameter_definitions` format with `strict_tools` mode. Ollama passes JSON Schema directly in a `format` field. The Vercel AI SDK accepts Zod schemas natively and handles conversion internally, but developers building tools that must work across multiple providers outside the Vercel ecosystem need an independent conversion layer.

The consequences of getting these conversions wrong are immediate and visible. If an OpenAI strict-mode schema is missing `additionalProperties: false` on a nested object, the API rejects the request with a 400 error. If a Gemini schema contains an unsupported keyword, the model may ignore the constraint silently or return a 400. If an Anthropic tool definition uses `parameters` instead of `input_schema`, the tool is not recognized. These are not subtle bugs -- they are hard failures that block the application from working at all. Developers currently solve this by maintaining separate schema definitions per provider, by writing ad-hoc transformation functions, or by using provider-specific SDK helpers that lock them into a single provider. None of these approaches scale to applications that support multiple providers simultaneously or that migrate between providers.

`schema-bridge` provides a `bridge` function that converts a schema to a specific provider's format, per-provider convenience functions (`bridge.openai`, `bridge.anthropic`, `bridge.gemini`, `bridge.mcp`, `bridge.cohere`, `bridge.ollama`), a `bridgeTool` function that converts a complete tool definition (name, description, schema) to a provider-specific tool object ready to pass to the provider's SDK, and a `bridgeTools` function for batch-converting all tools at once. It accepts Zod schemas (v3 and v4), JSON Schema objects (draft-07, draft-2020-12, OpenAPI 3.0/3.1), and TypeBox schemas as input. It auto-detects the input format, converts to a canonical internal JSON Schema representation, applies provider-specific transformations, and returns the result in the exact shape the provider's API expects. A `TransformationReport` documents every change made and warns when a transformation is lossy (a schema feature that cannot be represented in the target provider).

The package composes with other packages in this monorepo. `tool-output-guard` validates tool output against schemas at runtime -- it is a validation engine. `schema-bridge` converts schemas between provider formats -- it is a conversion engine. The two are complementary: use `schema-bridge` to generate provider-specific tool definitions, and use `tool-output-guard` to validate that tool outputs conform to the schema at runtime. `tool-call-retry` retries failed tool executions -- it operates on the execution side, not the schema side.

---

## 2. Goals and Non-Goals

### Goals

- Provide a `bridge(schema, provider, options?)` function that converts a Zod, JSON Schema, or TypeBox schema into a provider-specific structured output configuration, returning the exact object shape the provider's API expects.
- Provide per-provider convenience functions -- `bridge.openai(schema, options?)`, `bridge.anthropic(schema, options?)`, `bridge.gemini(schema, options?)`, `bridge.mcp(schema, options?)`, `bridge.cohere(schema, options?)`, `bridge.ollama(schema, options?)` -- that are equivalent to calling `bridge` with the provider argument pre-filled.
- Provide a `bridge.jsonSchema(schema)` function that converts a Zod or TypeBox schema to standard JSON Schema without any provider-specific transformations, serving as a general-purpose Zod-to-JSON-Schema utility.
- Provide a `bridgeTool(toolConfig, provider, options?)` function that converts a complete tool definition (name, description, input schema, optional output schema) into the provider-specific tool object format, ready to pass directly to the provider's SDK.
- Provide a `bridgeTools(tools, provider, options?)` function that batch-converts an array of tool definitions into provider-specific tool objects in a single call.
- Apply provider-specific JSON Schema transformations automatically: inject `additionalProperties: false` on every object for OpenAI strict mode, expand `required` to include all properties and convert optional fields to nullable for OpenAI, inline `$ref`/`$defs` references for providers that do not support them, simplify `oneOf`/`anyOf`/`allOf` for providers with restricted support, remove unsupported keywords (`minimum`, `maximum`, `format`, `pattern`, `default`) for providers that reject them, and wrap schemas in provider-specific envelope keys (`input_schema` for Anthropic, `responseSchema` for Gemini, `format` for Ollama).
- Handle recursive schemas (self-referencing types) correctly: detect cycles during `$ref` inlining and either preserve `$ref`/`$defs` for providers that support them (OpenAI, MCP) or report a lossy transformation warning for providers that do not.
- Accept three input schema formats: Zod schemas (detected by `_def` property and `safeParse` method, or by Zod v4's `~standard` property), JSON Schema objects (detected by `type` or `$schema` property), and TypeBox schemas (detected by `Symbol.for('TypeBox.Kind')`). Auto-detect the format without requiring the caller to specify it.
- Support both Zod v3 and Zod v4 as input. For Zod v4, prefer the native `z.toJSONSchema()` for conversion. For Zod v3, use `zod-to-json-schema` as a fallback.
- Return a `TransformationReport` alongside the converted schema, documenting every transformation applied, warnings for lossy conversions (features that cannot be represented in the target provider), and a per-provider compatibility assessment.
- Validate that the transformed schema is structurally valid for the target provider before returning it, catching errors like exceeding OpenAI's 100-property limit or 5-level nesting depth at build time rather than at API call time.
- Cache transformation results: identical schema + provider + options combinations return the same result without re-computing. Schema identity is determined by deep structural equality, not reference equality.
- Keep runtime dependencies to zero for the core conversion logic. Zod is a peer dependency (optional -- only required if the caller uses Zod schemas). `zod-to-json-schema` is a peer dependency (optional -- only required for Zod v3 schemas; Zod v4 has native JSON Schema conversion).

### Non-Goals

- **Not a validation library.** This package converts schemas between formats. It does not validate data against schemas. Use `tool-output-guard` for runtime output validation, or Zod's `parse`/`safeParse` for input validation. `schema-bridge` ensures the schema is in the right format for the provider; it does not check that actual data conforms to the schema.
- **Not an LLM client.** This package does not make API calls to any provider. It produces the configuration objects that the caller passes to provider SDKs (`openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, etc.). The caller is responsible for making the API call.
- **Not a tool execution framework.** This package converts tool definitions. It does not execute tools, manage tool registries, or handle tool results. For tool execution resilience, use `tool-call-retry`. For tool output validation, use `tool-output-guard`.
- **Not a full JSON Schema validator.** The built-in provider validation checks structural constraints specific to each provider (nesting depth, property count, required keyword restrictions). It does not fully validate that the input is valid JSON Schema per the specification. If the input schema is itself malformed, the output is undefined.
- **Not a schema authoring tool.** This package converts existing schemas. It does not help write schemas, generate schemas from TypeScript types, or provide a schema builder API. Use Zod, TypeBox, or a JSON Schema editor for authoring.
- **Not a bidirectional converter.** This package converts from source schemas (Zod, JSON Schema, TypeBox) to provider-specific formats. It does not convert from a provider-specific format back to Zod or generic JSON Schema. The conversion is one-directional: source to target.

---

## 3. Target Users and Use Cases

### Multi-Provider Application Developers

Developers building applications that support multiple LLM providers simultaneously -- for example, an application where the user selects their preferred provider (OpenAI, Anthropic, Gemini) and the application routes requests accordingly. These developers define tool schemas once (typically in Zod for type safety) and need provider-specific tool definitions generated on demand. Without `schema-bridge`, they maintain parallel schema definitions per provider, which diverge over time and introduce subtle inconsistencies. A typical integration is: `const tools = bridgeTools(myTools, userSelectedProvider)`.

### Provider Migration Teams

Teams migrating from one LLM provider to another. They have dozens or hundreds of tool definitions written for OpenAI's function calling format and need to convert them to Anthropic's tool use format or Gemini's function declarations. `schema-bridge` converts the existing schemas to the new provider's format, producing a diff report that highlights lossy transformations requiring manual attention.

### MCP Server Authors

Developers building MCP servers whose tools need to be compatible with multiple LLM providers on the client side. MCP defines tools with `inputSchema` (JSON Schema), but MCP clients (Claude Desktop, custom agents) may forward these schemas to different LLM providers for structured output. `schema-bridge` ensures the tool schemas are valid for whichever provider the client uses. An MCP server author can use `bridge.mcp(zodSchema)` to generate the `inputSchema` and simultaneously use `bridge.openai(zodSchema)` to verify compatibility with OpenAI clients.

### Tool Library Authors

Developers building reusable tool libraries (search tools, database connectors, API wrappers) that must work across agent frameworks. Each framework may use a different LLM provider. The tool library author defines schemas in Zod for type safety and ships provider-specific schemas using `schema-bridge`, ensuring their tools work out of the box with any framework.

### Vercel AI SDK Users Targeting Non-Vercel Deployments

Developers who use Zod schemas with the Vercel AI SDK during development but deploy their tools in environments outside the Vercel ecosystem -- standalone Node.js servers, AWS Lambda functions, or custom agent frameworks that call provider APIs directly. The Vercel AI SDK handles schema conversion internally, but when deploying outside the SDK, developers need an independent conversion layer. `schema-bridge` fills this gap.

### Agent Framework Authors

Teams building agent orchestration frameworks that support pluggable LLM providers. The framework accepts tool definitions with Zod schemas from framework users and needs to convert those schemas to whichever provider the framework is configured to use. `schema-bridge` provides the conversion layer, so the framework author does not need to implement per-provider schema transformation logic themselves.

---

## 4. Core Concepts

### Source Schema

The source schema is the developer's original schema definition, written in Zod, JSON Schema, or TypeBox. It represents the canonical shape of the data without any provider-specific constraints. The source schema is the single source of truth. All provider-specific schemas are derived from it.

### Canonical JSON Schema

The canonical JSON Schema is the intermediate representation that `schema-bridge` uses internally. When the input is a Zod schema, it is converted to JSON Schema (draft-2020-12) using Zod v4's native `z.toJSONSchema()` or `zod-to-json-schema` for Zod v3. When the input is a TypeBox schema, it is used directly (TypeBox schemas are JSON Schema objects). When the input is already a JSON Schema object, it is normalized to a consistent internal format. All provider-specific transformations operate on this canonical form.

### Provider Adapter

A provider adapter is the module responsible for transforming the canonical JSON Schema into the specific format required by a single provider. Each supported provider has one adapter. The adapter knows the provider's structural requirements (which keywords are supported, which must be injected, which must be removed), the provider's envelope format (how the schema is wrapped for the API call), and the provider's constraints (maximum nesting depth, property count limits). Adapters are pure functions: they take a canonical JSON Schema and options, and return the provider-specific output plus a transformation report.

### Transformation

A transformation is a single modification applied to the canonical JSON Schema to make it compatible with a target provider. Transformations include injecting `additionalProperties: false` on objects, inlining `$ref` references, expanding `required` arrays, converting optional fields to nullable types, removing unsupported keywords, and wrapping schemas in provider-specific envelopes. Each transformation is recorded in the `TransformationReport`.

### Transformation Report

The transformation report documents every change made during conversion. It lists each transformation with the JSON path of the affected node, the type of transformation, the before and after values, and whether the transformation is lossless (can be reversed without information loss) or lossy (the target provider cannot represent the source feature). Lossy transformations generate warnings. The report enables developers to audit what `schema-bridge` changed and to identify schema features that need manual attention.

### Tool Definition

A tool definition is a higher-level object that combines a schema with metadata: the tool's name, description, input schema, and optional output schema. Providers expect tool definitions in different formats: OpenAI uses `{ type: "function", function: { name, description, parameters, strict } }`, Anthropic uses `{ name, description, input_schema }`, Gemini uses `{ name, description, parameters }` inside a `functionDeclarations` array. `schema-bridge`'s `bridgeTool` function converts a unified tool definition into whichever provider-specific format is needed.

### Provider Quirk

A provider quirk is a deviation from standard JSON Schema behavior that a specific provider imposes. Quirks include required keyword injections (OpenAI's `additionalProperties: false`), keyword restrictions (Gemini's historical lack of `$ref` support), envelope differences (Anthropic's `input_schema` vs OpenAI's `parameters`), and structural limits (OpenAI's 100-property maximum, 5-level nesting depth). The term "quirk" is used rather than "limitation" because many of these behaviors are intentional design choices by the provider, not bugs.

---

## 5. Provider Quirks Catalog

This section catalogs every known schema restriction, requirement, and format difference for each supported provider. This catalog is the core knowledge base that `schema-bridge` encodes in its provider adapters.

### OpenAI

OpenAI supports structured output through two mechanisms: `response_format` with `type: "json_schema"` for response-level structured output, and function/tool definitions with `strict: true` for tool-level structured output. Both use the same underlying JSON Schema processing.

**Strict mode requirements (when `strict: true`):**

| Requirement | Detail |
|---|---|
| `additionalProperties: false` | Must be set on every object in the schema, at every nesting level. If missing on any object, the API returns a 400 error. |
| All properties in `required` | Every property defined in `properties` must appear in the `required` array. There are no truly optional fields in strict mode. |
| Optional fields as nullable | To represent optional fields, include the property in `required` but set its type to a nullable variant: `"type": ["string", "null"]` or use `"anyOf": [{"type": "string"}, {"type": "null"}]`. The model will output `null` for fields it considers optional. |
| `$ref` / `$defs` support | Supported for recursive schemas. References must point to `$defs` at the top level of the schema. Nested `$defs` are not supported. |
| `anyOf` support | Supported for nullable types and discriminated unions. Root-level `anyOf` is not allowed -- the root must be an object type. |
| `oneOf` / `allOf` | Not reliably supported in strict mode. Schemas using these keywords may be rejected or produce undefined behavior. |
| `enum` | Supported. Maximum 500 enum values across all properties. |
| `const` | Supported. Combined character count of all `enum` values and `const` values must not exceed 15,000. |
| Maximum properties | 100 total properties across the entire schema (including nested objects). |
| Maximum nesting depth | 5 levels of object nesting. |
| Unsupported keywords | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minLength`, `maxLength`, `minItems`, `maxItems`, `pattern`, `format`, `default`, `if`/`then`/`else`, `patternProperties`, `unevaluatedProperties`, `not`. These keywords are silently ignored or cause errors. |
| Schema caching | OpenAI caches compiled schemas. First request with a new schema incurs additional latency. Subsequent requests with the same schema are faster. |

**Response format envelope:**

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "<schema_name>",
      "schema": { /* JSON Schema */ },
      "strict": true
    }
  }
}
```

**Tool definition format:**

```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "Get current weather for a location",
    "parameters": { /* JSON Schema */ },
    "strict": true
  }
}
```

### Anthropic

Anthropic supports tool use through tool definitions in the `tools` array and has a structured output beta (as of late 2025) that provides schema-constrained generation.

**Tool definition format:**

```json
{
  "name": "get_weather",
  "description": "Get current weather for a location",
  "input_schema": {
    "type": "object",
    "properties": { /* ... */ },
    "required": ["location"]
  }
}
```

**Key differences from OpenAI:**

| Requirement | Detail |
|---|---|
| Wrapper key | `input_schema`, not `parameters`. This is the single most common source of cross-provider bugs. |
| `additionalProperties` | Not required by default for standard tool use. Required when using structured output beta with `strict: true`. |
| `required` expansion | Not required. Optional fields can be omitted from `required` and represented as truly optional. |
| `$ref` / `$defs` | Supported in `input_schema`. Standard JSON Schema references work. |
| `anyOf` / `oneOf` / `allOf` | Supported. Broader JSON Schema support than OpenAI strict mode. |
| Numeric constraints | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` are supported. |
| String constraints | `minLength`, `maxLength`, `pattern` are supported. |
| `format` | Supported but not enforced by the model -- serves as a hint in the description. |
| `default` | Supported in schema but the model does not automatically use default values. |
| `enum` | Supported with no documented maximum. |
| Nesting depth | No documented limit. |
| Property count | No documented limit. |

**Structured output beta (strict mode):**

When using the `anthropic-beta: structured-outputs-2025-11-13` header with compatible models (Sonnet 4.5, Opus 4.1), Anthropic supports strict structured output that constrains token generation to match the schema. In this mode, `additionalProperties: false` is required, similar to OpenAI strict mode. Available on tools via `"strict": true` on the tool definition.

### Google Gemini

Gemini supports structured output through `responseSchema` in `generationConfig` and function calling through `functionDeclarations` in the `tools` array.

**Response schema format:**

```json
{
  "generationConfig": {
    "responseMimeType": "application/json",
    "responseSchema": { /* JSON Schema / OpenAPI Schema */ }
  }
}
```

**Function declaration format:**

```json
{
  "tools": [{
    "functionDeclarations": [{
      "name": "get_weather",
      "description": "Get current weather",
      "parameters": {
        "type": "OBJECT",
        "properties": { /* ... */ },
        "required": ["location"]
      }
    }]
  }]
```

**Key restrictions and quirks:**

| Requirement | Detail |
|---|---|
| Type constants | Some SDK versions use uppercase type strings: `"OBJECT"`, `"STRING"`, `"NUMBER"`, `"INTEGER"`, `"BOOLEAN"`, `"ARRAY"`. The REST API accepts lowercase. |
| `$ref` / `$defs` | Supported as of the November 2025 JSON Schema update. Older model versions and some SDKs may not support them. |
| `anyOf` | Supported as of the November 2025 update. Older model versions do not support it. Complex `anyOf` schemas may trigger `InvalidArgument` errors. |
| `oneOf` / `allOf` | Limited support. May cause errors with some model versions. |
| `additionalProperties` | Supported as of the November 2025 update. Some SDK versions (notably the Python SDK) reject it in client-side validation even though the API accepts it. |
| Property ordering | The API preserves the ordering of keys as specified in the schema. If descriptions, schemas, or examples in the prompt present properties in a different order than `responseSchema`, the model may produce incorrect or malformed output. |
| Unsupported keywords (historical) | `default`, `optional` (use `required` array instead). The `format` keyword has limited support. |
| Schema complexity limits | Complex schemas (long property names, large enum arrays, many optional properties, deep nesting) may trigger `InvalidArgument` errors. No documented hard limits on property count or nesting depth, but empirical limits exist. |
| Nullable fields | Use `"nullable": true` property or include `"null"` in the type array, depending on the SDK version. |

### MCP (Model Context Protocol)

MCP uses standard JSON Schema for tool definitions. It is the most permissive target format.

**Tool definition format:**

```json
{
  "name": "get_weather",
  "description": "Get current weather",
  "inputSchema": {
    "type": "object",
    "properties": { /* ... */ },
    "required": ["location"]
  },
  "outputSchema": {
    "type": "object",
    "properties": { /* ... */ },
    "required": ["temperature", "conditions"]
  }
}
```

**Key characteristics:**

| Requirement | Detail |
|---|---|
| Wrapper key | `inputSchema` (camelCase), not `input_schema` (snake_case) or `parameters`. |
| Output schema | MCP uniquely supports `outputSchema` on tool definitions, enabling clients to validate tool results. |
| JSON Schema support | Full JSON Schema draft-07 or draft-2020-12. No known keyword restrictions. |
| `$ref` / `$defs` | Fully supported. |
| `anyOf` / `oneOf` / `allOf` | Fully supported. |
| Constraints | All numeric, string, and array constraints supported. |
| No structural limits | No documented limits on nesting depth, property count, or enum size. |

### Cohere

Cohere supports structured output through two modes: JSON response format with a schema, and tool use with `strict_tools`.

**Tool definition format (V2 API):**

```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "Get current weather",
    "parameters": {
      "type": "object",
      "properties": { /* ... */ },
      "required": ["location"]
    }
  }
}
```

**Key characteristics:**

| Requirement | Detail |
|---|---|
| `strict_tools` parameter | When `strict_tools: true` is set on the API call (not per-tool), all tool calls are guaranteed to follow the schema. |
| JSON Schema support | Standard JSON Schema notation for parameter definitions. |
| Supported types | `string`, `number`, `integer`, `boolean`, `array`, `object`. |
| `enum` | Supported. |
| Nested objects | Supported. |
| `$ref` / `$defs` | Limited documentation. Inline schemas recommended. |

### Ollama

Ollama supports structured output by passing a JSON Schema directly in the `format` field of the API request.

**Request format:**

```json
{
  "model": "llama3.2",
  "messages": [{ "role": "user", "content": "..." }],
  "format": { /* JSON Schema */ }
}
```

**Key characteristics:**

| Requirement | Detail |
|---|---|
| Schema location | Passed directly as the `format` field value. No envelope or wrapper. |
| JSON Schema support | Standard JSON Schema. Support level depends on the underlying model and llama.cpp's grammar generation. |
| `$ref` / `$defs` | Support varies by Ollama version. Inline schemas recommended for maximum compatibility. |
| Model-dependent behavior | Not all models handle all JSON Schema features equally. Simpler schemas produce more reliable results. |
| Temperature interaction | Low temperature (e.g., 0) produces more reliable schema adherence. At higher temperatures, the grammar constraint still applies but output quality may degrade. |

### Vercel AI SDK

The Vercel AI SDK is not a direct provider target (it handles its own schema conversion internally), but `schema-bridge` supports generating schemas compatible with the SDK's `tool` function.

**Tool definition format:**

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const weatherTool = tool({
  description: 'Get current weather',
  parameters: z.object({ location: z.string() }),
  execute: async ({ location }) => { /* ... */ },
});
```

The SDK accepts Zod schemas directly and converts them to JSON Schema internally using `zod-to-json-schema`. `schema-bridge` can produce the JSON Schema that the SDK would generate, useful for debugging or for building tools outside the SDK that must produce compatible schemas.

### Provider Feature Support Matrix

| Feature | OpenAI (strict) | Anthropic | Gemini | MCP | Cohere | Ollama |
|---|---|---|---|---|---|---|
| `additionalProperties: false` required | Yes | No (Yes in strict beta) | No | No | No | No |
| All fields in `required` | Yes | No | No | No | No | No |
| Optional as nullable | Yes | No | No | No | No | No |
| `$ref` / `$defs` | Top-level only | Yes | Yes (Nov 2025+) | Yes | Limited | Varies |
| `anyOf` | Nullable/union only | Yes | Yes (Nov 2025+) | Yes | Yes | Varies |
| `oneOf` | No | Yes | Limited | Yes | Yes | Varies |
| `allOf` | No | Yes | Limited | Yes | Yes | Varies |
| `minimum` / `maximum` | No | Yes | Yes | Yes | Yes | Yes |
| `minLength` / `maxLength` | No | Yes | Yes | Yes | Yes | Yes |
| `pattern` | No | Yes | Limited | Yes | Yes | Varies |
| `format` | No | Hint only | Limited | Yes | Yes | Varies |
| `default` | No | Yes | No | Yes | Yes | Varies |
| Max properties | 100 | None | Soft limit | None | None | None |
| Max nesting depth | 5 | None | Soft limit | None | None | None |
| Max enum values | 500 | None | Soft limit | None | None | None |
| Schema wrapper key | `parameters` / `schema` | `input_schema` | `parameters` / `responseSchema` | `inputSchema` | `parameters` | `format` |
| Output schema support | No | No | No | Yes | No | No |

---

## 6. Schema Transformations

This section details every transformation that `schema-bridge` applies when converting a canonical JSON Schema to a provider-specific format. Transformations are applied in a deterministic order. Each transformation is independent: it operates on the schema tree and produces a modified tree plus a transformation record.

### 6.1 `$ref` / `$defs` Inlining

**What it does:** Replaces `$ref` pointers with the referenced schema definition inlined directly at the reference site. Removes `$defs` from the schema root after all references are resolved.

**When it applies:** Providers that do not support `$ref` (older Gemini versions, Ollama for maximum compatibility) or that require top-level-only `$defs` (OpenAI). For OpenAI, `$ref`/`$defs` at the top level are preserved for recursive schemas but nested `$defs` are hoisted to the top level.

**How it works:**

1. Walk the schema tree. Collect all `$defs` definitions.
2. For each `$ref` pointer, resolve it to the referenced definition.
3. Replace the `$ref` node with a deep clone of the referenced definition.
4. After all references are resolved, remove the `$defs` block if no references remain.
5. For recursive schemas (where a `$ref` points to an ancestor in the tree), detect the cycle and either preserve the `$ref` (for providers that support it) or report a lossy transformation warning (for providers that do not).

**Cycle detection:** When inlining encounters a reference that has already been visited in the current resolution path, it recognizes a recursive schema. For OpenAI, the recursive `$ref` is preserved with `$defs` at the top level. For providers without `$ref` support, the transformation reports a `LOSSY_RECURSIVE_SCHEMA` warning and truncates the recursion at a configurable depth (default: 5 levels), inserting an empty object schema (`{}`) at the truncation point.

**Transformation record:**

```
{ type: 'REF_INLINED', path: '$.properties.address', ref: '#/$defs/Address', lossy: false }
```

### 6.2 `additionalProperties: false` Injection

**What it does:** Adds `"additionalProperties": false` to every object-type node in the schema tree.

**When it applies:** OpenAI strict mode. Anthropic strict mode beta. Configurable for other providers via options.

**How it works:**

1. Walk the schema tree recursively.
2. For every node where `type` is `"object"` (or where `properties` is present, implying an object), check if `additionalProperties` is already set.
3. If `additionalProperties` is absent or set to `true`, set it to `false`.
4. If `additionalProperties` is set to a schema object (allowing additional properties of a specific type), replace it with `false` and record a lossy transformation.
5. Apply recursively to nested objects inside `properties`, `items`, `anyOf`, `oneOf`, `allOf`, and `$defs`.

**Lossy case:** If the source schema intentionally allows additional properties (e.g., `additionalProperties: { type: "string" }` for a map-like object), forcing it to `false` changes the schema's semantics. This is recorded as a `LOSSY_ADDITIONAL_PROPERTIES` warning.

**Transformation record:**

```
{ type: 'ADDITIONAL_PROPERTIES_INJECTED', path: '$.properties.metadata', previousValue: true, lossy: false }
```

### 6.3 `required` Array Expansion (OpenAI Strict Mode)

**What it does:** Ensures every property defined in `properties` appears in the `required` array. Properties that were not originally required are made required but their type is changed to a nullable variant.

**When it applies:** OpenAI strict mode only.

**How it works:**

1. For each object node, compare `properties` keys against the `required` array.
2. For each property that is in `properties` but not in `required`:
   a. Add the property name to `required`.
   b. Modify the property's schema to accept `null` in addition to its original type.
   c. If the property's type is a string (e.g., `"type": "string"`), change it to `"type": ["string", "null"]`.
   d. If the property already uses `anyOf` or `oneOf`, add `{"type": "null"}` as an additional option.
3. Apply recursively to nested objects.

**Example:**

Before (source schema):
```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "nickname": { "type": "string" }
  },
  "required": ["name"]
}
```

After (OpenAI strict mode):
```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "nickname": { "type": ["string", "null"] }
  },
  "required": ["name", "nickname"],
  "additionalProperties": false
}
```

**Transformation record:**

```
{ type: 'REQUIRED_EXPANDED', path: '$.properties.nickname', madeNullable: true, lossy: false }
```

### 6.4 `oneOf` / `anyOf` / `allOf` Simplification

**What it does:** Simplifies or removes composition keywords for providers that do not support them.

**When it applies:** OpenAI strict mode (limited `anyOf` support, no `oneOf`/`allOf`). Older Gemini versions. Configurable for other providers.

**Simplification rules:**

| Source Pattern | Target Pattern | Lossy? |
|---|---|---|
| `anyOf: [T, {type: "null"}]` | `type: [T.type, "null"]` | No (semantic equivalent for nullable) |
| `anyOf: [T1, T2]` (two types) | Kept as `anyOf` if provider supports it, otherwise merged or first type used with warning | Potentially yes |
| `oneOf: [T1, T2, ...]` | Converted to `anyOf` if provider supports `anyOf`, otherwise first type used with warning | Yes if falling back to first type |
| `allOf: [S1, S2]` | Merged into a single object schema (combine `properties`, `required`) | No if merge is clean; yes if conflicts exist |
| `allOf: [{$ref: X}, {properties: ...}]` | Resolve ref, merge properties | No |
| `not: S` | Removed with warning | Yes |

**Transformation record:**

```
{ type: 'COMPOSITION_SIMPLIFIED', path: '$.properties.value', from: 'oneOf', to: 'anyOf', lossy: false }
```

### 6.5 Unsupported Keyword Removal

**What it does:** Removes JSON Schema keywords that the target provider does not support.

**When it applies:** Provider-specific. OpenAI strict mode strips the most keywords.

**Keywords removed per provider:**

| Keyword | OpenAI (strict) | Anthropic | Gemini | MCP | Cohere | Ollama |
|---|---|---|---|---|---|---|
| `minimum` / `maximum` | Removed | Kept | Kept | Kept | Kept | Kept |
| `exclusiveMinimum` / `exclusiveMaximum` | Removed | Kept | Kept | Kept | Kept | Kept |
| `multipleOf` | Removed | Kept | Kept | Kept | Kept | Kept |
| `minLength` / `maxLength` | Removed | Kept | Kept | Kept | Kept | Kept |
| `minItems` / `maxItems` | Removed | Kept | Kept | Kept | Kept | Kept |
| `pattern` | Removed | Kept | Varies | Kept | Kept | Varies |
| `format` | Removed | Kept | Varies | Kept | Kept | Varies |
| `default` | Removed | Kept | Removed | Kept | Kept | Varies |
| `examples` | Removed | Kept | Removed | Kept | Kept | Removed |
| `$comment` | Removed | Removed | Removed | Kept | Removed | Removed |
| `title` | Kept | Kept | Kept | Kept | Kept | Kept |
| `description` | Kept | Kept | Kept | Kept | Kept | Kept |

**Lossy assessment:** Removing validation keywords (`minimum`, `pattern`, etc.) is technically lossy because the target schema is less restrictive than the source. However, these keywords are validation constraints, not structural constraints -- the LLM may still respect them if they are mentioned in the `description` field. `schema-bridge` optionally appends removed constraints to the `description` field (e.g., changing `"description": "User age"` to `"description": "User age (minimum: 0, maximum: 150)"`) when the `promoteConstraintsToDescription` option is enabled.

**Transformation record:**

```
{ type: 'KEYWORD_REMOVED', path: '$.properties.age', keyword: 'minimum', value: 0, lossy: true, promotedToDescription: true }
```

### 6.6 Description Propagation

**What it does:** Ensures that `description` fields from the source schema are preserved through all transformations. Optionally appends removed constraint information to descriptions.

**When it applies:** All providers. Descriptions are the primary mechanism for communicating schema intent to the LLM.

**How it works:**

1. Preserve all existing `description` fields during transformation.
2. If `promoteConstraintsToDescription` is enabled and a validation keyword is removed, append the constraint to the description.
3. If the source is a Zod schema and `.describe()` was used, the description is extracted during Zod-to-JSON-Schema conversion and preserved.

### 6.7 Default Value Handling

**What it does:** Handles the `default` keyword according to provider requirements.

**When it applies:** Providers that do not support `default` (OpenAI, Gemini).

**How it works:**

1. If the target provider does not support `default`, remove it from the schema.
2. If `promoteConstraintsToDescription` is enabled, append the default value to the description (e.g., `"description": "Response format (default: json)"`).
3. For MCP and Anthropic, `default` is preserved as-is.

### 6.8 Recursive Schema Handling

**What it does:** Detects self-referencing schemas and handles them appropriately per provider.

**When it applies:** Any schema that contains `$ref` pointing to an ancestor or to a `$defs` entry that itself references back.

**Strategy per provider:**

| Provider | Strategy |
|---|---|
| OpenAI | Preserve `$ref`/`$defs` at top level. OpenAI supports recursive schemas. Apply all other strict mode transforms to the `$defs` definitions themselves. |
| Anthropic | Preserve `$ref`/`$defs`. Standard JSON Schema. |
| Gemini (Nov 2025+) | Preserve `$ref`/`$defs`. Supported in recent models. |
| Gemini (older) | Report `LOSSY_RECURSIVE_SCHEMA` warning. Truncate at configurable depth. |
| MCP | Preserve `$ref`/`$defs`. Full JSON Schema support. |
| Cohere | Inline where possible. Report warning for true recursion. |
| Ollama | Inline where possible. Report warning for true recursion. |

---

## 7. API Surface

### Installation

```bash
npm install schema-bridge
```

Peer dependencies (all optional -- install only what you use):
```bash
npm install zod                  # Required if using Zod schemas
npm install zod-to-json-schema   # Required if using Zod v3 schemas (Zod v4 has native conversion)
```

### Primary Function: `bridge`

Converts a schema to a provider-specific format.

```typescript
import { bridge } from 'schema-bridge';
import { z } from 'zod';

const WeatherSchema = z.object({
  temperature: z.number().describe('Temperature in Fahrenheit'),
  conditions: z.string().describe('Weather conditions'),
  humidity: z.number().optional().describe('Humidity percentage'),
});

// Convert to OpenAI strict mode
const openaiSchema = bridge(WeatherSchema, 'openai');
// {
//   schema: { type: "object", properties: { ... }, required: [...], additionalProperties: false },
//   report: TransformationReport
// }

// Convert to Anthropic tool input_schema
const anthropicSchema = bridge(WeatherSchema, 'anthropic');
// {
//   schema: { type: "object", properties: { ... }, required: ["temperature", "conditions"] },
//   report: TransformationReport
// }
```

### Per-Provider Convenience Functions

```typescript
import { bridge } from 'schema-bridge';

// Each returns { schema, report }
const openai    = bridge.openai(schema, options?);
const anthropic = bridge.anthropic(schema, options?);
const gemini    = bridge.gemini(schema, options?);
const mcp       = bridge.mcp(schema, options?);
const cohere    = bridge.cohere(schema, options?);
const ollama    = bridge.ollama(schema, options?);

// Standard JSON Schema (no provider transformations)
const jsonSchema = bridge.jsonSchema(schema);
```

### Tool Definition Bridging: `bridgeTool`

Converts a complete tool definition to a provider-specific format.

```typescript
import { bridgeTool } from 'schema-bridge';
import { z } from 'zod';

const weatherTool = {
  name: 'get_weather',
  description: 'Get current weather for a location',
  schema: z.object({
    location: z.string().describe('City and state'),
    units: z.enum(['fahrenheit', 'celsius']).optional(),
  }),
};

// OpenAI tool definition
const openaiTool = bridgeTool(weatherTool, 'openai');
// {
//   tool: {
//     type: "function",
//     function: {
//       name: "get_weather",
//       description: "Get current weather for a location",
//       parameters: { ... },   // Transformed schema
//       strict: true
//     }
//   },
//   report: TransformationReport
// }

// Anthropic tool definition
const anthropicTool = bridgeTool(weatherTool, 'anthropic');
// {
//   tool: {
//     name: "get_weather",
//     description: "Get current weather for a location",
//     input_schema: { ... }   // Transformed schema
//   },
//   report: TransformationReport
// }

// Gemini function declaration
const geminiTool = bridgeTool(weatherTool, 'gemini');
// {
//   tool: {
//     name: "get_weather",
//     description: "Get current weather for a location",
//     parameters: { ... }     // Transformed schema
//   },
//   report: TransformationReport
// }

// MCP tool definition
const mcpTool = bridgeTool(weatherTool, 'mcp');
// {
//   tool: {
//     name: "get_weather",
//     description: "Get current weather for a location",
//     inputSchema: { ... }    // Transformed schema
//   },
//   report: TransformationReport
// }
```

### Batch Tool Bridging: `bridgeTools`

Converts an array of tool definitions to provider-specific format in a single call.

```typescript
import { bridgeTools } from 'schema-bridge';

const tools = [
  { name: 'get_weather', description: '...', schema: weatherSchema },
  { name: 'search_web', description: '...', schema: searchSchema },
  { name: 'send_email', description: '...', schema: emailSchema },
];

const openaiTools = bridgeTools(tools, 'openai');
// {
//   tools: [ { type: "function", function: { ... } }, ... ],
//   reports: [ TransformationReport, TransformationReport, TransformationReport ]
// }

// Gemini wraps tools in functionDeclarations
const geminiTools = bridgeTools(tools, 'gemini');
// {
//   tools: [{ functionDeclarations: [ { name, description, parameters }, ... ] }],
//   reports: [ ... ]
// }
```

### Type Definitions

```typescript
// ── Provider Identifiers ────────────────────────────────────────────

/** Supported provider identifiers. */
type Provider = 'openai' | 'anthropic' | 'gemini' | 'mcp' | 'cohere' | 'ollama';

// ── Input Schema Types ──────────────────────────────────────────────

/** Any schema type accepted as input. */
type InputSchema = ZodSchema | JSONSchemaObject | TypeBoxSchema;

/** A JSON Schema object (draft-07, draft-2020-12, or OpenAPI 3.0/3.1). */
interface JSONSchemaObject {
  type?: string | string[];
  properties?: Record<string, JSONSchemaObject>;
  required?: string[];
  items?: JSONSchemaObject | JSONSchemaObject[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: JSONSchemaObject[];
  oneOf?: JSONSchemaObject[];
  allOf?: JSONSchemaObject[];
  not?: JSONSchemaObject;
  $ref?: string;
  $defs?: Record<string, JSONSchemaObject>;
  definitions?: Record<string, JSONSchemaObject>;
  additionalProperties?: boolean | JSONSchemaObject;
  description?: string;
  title?: string;
  default?: unknown;
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  multipleOf?: number;
  $schema?: string;
  [key: string]: unknown;
}

// ── Bridge Options ──────────────────────────────────────────────────

/** Options for schema conversion. */
interface BridgeOptions {
  /** Whether to enable strict mode for providers that support it.
   *  OpenAI: sets strict: true, enforces additionalProperties: false, required expansion.
   *  Anthropic: sets strict: true when using structured output beta.
   *  Default: true. */
  strict?: boolean;

  /** Whether to append removed constraints to description fields.
   *  When a keyword like `minimum` is removed for a provider, append it to the
   *  field's description so the LLM can still see the constraint as a hint.
   *  Default: true. */
  promoteConstraintsToDescription?: boolean;

  /** Maximum recursion depth when truncating recursive schemas for providers
   *  that do not support $ref. Default: 5. */
  maxRecursionDepth?: number;

  /** Schema name. Used by OpenAI's json_schema response format (the `name` field).
   *  Default: inferred from the schema's title or 'schema'. */
  schemaName?: string;

  /** Target JSON Schema draft for the output.
   *  'draft-07' | 'draft-2020-12' | 'openapi-3.0' | 'openapi-3.1'
   *  Default: 'draft-2020-12'. */
  targetDraft?: string;

  /** Whether to validate the transformed schema against the provider's known
   *  constraints (property count, nesting depth, enum limits).
   *  Default: true. */
  validate?: boolean;

  /** Custom transformation functions to apply after provider-specific transforms.
   *  Receives the transformed JSON Schema and returns a modified version. */
  customTransforms?: Array<(schema: JSONSchemaObject, provider: Provider) => JSONSchemaObject>;
}

// ── Tool Definition Input ───────────────────────────────────────────

/** A provider-agnostic tool definition. */
interface ToolDefinition {
  /** The tool's name. Must be a valid identifier (a-z, A-Z, 0-9, underscores). */
  name: string;

  /** Human-readable description of what the tool does. */
  description: string;

  /** The input schema for the tool's parameters. Zod, JSON Schema, or TypeBox. */
  schema: InputSchema;

  /** Optional output schema (used by MCP). */
  outputSchema?: InputSchema;
}

// ── Bridge Result ───────────────────────────────────────────────────

/** Result of a schema bridge operation. */
interface BridgeResult {
  /** The transformed schema in the provider-specific format. */
  schema: JSONSchemaObject;

  /** Report of all transformations applied. */
  report: TransformationReport;
}

/** Result of a tool bridge operation. */
interface BridgeToolResult {
  /** The provider-specific tool definition object.
   *  Ready to pass directly to the provider's SDK. */
  tool: Record<string, unknown>;

  /** Report of all transformations applied to the schema(s). */
  report: TransformationReport;
}

/** Result of a batch tool bridge operation. */
interface BridgeToolsResult {
  /** Array of provider-specific tool definition objects.
   *  For Gemini, this is a single object with functionDeclarations array. */
  tools: Array<Record<string, unknown>> | Record<string, unknown>;

  /** Per-tool transformation reports. */
  reports: TransformationReport[];
}

// ── Transformation Report ───────────────────────────────────────────

/** A complete report of transformations applied during bridging. */
interface TransformationReport {
  /** The source schema format that was detected. */
  sourceFormat: 'zod' | 'json-schema' | 'typebox';

  /** The target provider. */
  targetProvider: Provider;

  /** Individual transformation records, in order of application. */
  transformations: TransformationRecord[];

  /** Warnings for lossy transformations. */
  warnings: TransformationWarning[];

  /** Whether any lossy transformations were applied. */
  hasLossyTransformations: boolean;

  /** Validation result: whether the output schema passes provider-specific validation. */
  validation: {
    valid: boolean;
    errors: string[];
  };

  /** Summary statistics. */
  summary: {
    /** Total number of transformations applied. */
    totalTransformations: number;

    /** Number of lossless transformations. */
    losslessCount: number;

    /** Number of lossy transformations. */
    lossyCount: number;

    /** Number of keywords removed. */
    keywordsRemoved: number;

    /** Number of $ref pointers inlined. */
    refsInlined: number;

    /** Number of fields made nullable (OpenAI required expansion). */
    fieldsMadeNullable: number;
  };
}

/** A single transformation record. */
interface TransformationRecord {
  /** Type of transformation. */
  type: TransformationType;

  /** JSON path of the affected schema node. */
  path: string;

  /** Human-readable description of the transformation. */
  description: string;

  /** Whether this transformation is lossy. */
  lossy: boolean;

  /** The value before transformation (for keywords that were changed or removed). */
  before?: unknown;

  /** The value after transformation. */
  after?: unknown;
}

/** Transformation types. */
type TransformationType =
  | 'REF_INLINED'
  | 'ADDITIONAL_PROPERTIES_INJECTED'
  | 'REQUIRED_EXPANDED'
  | 'FIELD_MADE_NULLABLE'
  | 'KEYWORD_REMOVED'
  | 'KEYWORD_PROMOTED_TO_DESCRIPTION'
  | 'COMPOSITION_SIMPLIFIED'
  | 'RECURSIVE_SCHEMA_TRUNCATED'
  | 'TYPE_CONSTANT_UPPERCASED'
  | 'SCHEMA_WRAPPED'
  | 'DEFAULT_REMOVED';

/** A warning about a lossy transformation. */
interface TransformationWarning {
  /** Warning code. */
  code: string;

  /** Human-readable warning message. */
  message: string;

  /** JSON path of the affected node. */
  path: string;

  /** Severity: 'info' for minor cosmetic changes, 'warning' for lossy but manageable,
   *  'error' for transformations that may cause the schema to behave incorrectly. */
  severity: 'info' | 'warning' | 'error';
}
```

### Function Signatures

```typescript
/**
 * Convert a schema to a provider-specific format.
 *
 * @param schema - Zod schema, JSON Schema, or TypeBox schema.
 * @param provider - Target provider identifier.
 * @param options - Conversion options.
 * @returns The transformed schema and a transformation report.
 */
function bridge(
  schema: InputSchema,
  provider: Provider,
  options?: Partial<BridgeOptions>,
): BridgeResult;

/**
 * Convert a schema to standard JSON Schema (no provider-specific transforms).
 *
 * @param schema - Zod schema, JSON Schema, or TypeBox schema.
 * @returns Standard JSON Schema (draft-2020-12 by default).
 */
bridge.jsonSchema(schema: InputSchema): JSONSchemaObject;

/**
 * Convert a tool definition to a provider-specific format.
 *
 * @param tool - Provider-agnostic tool definition.
 * @param provider - Target provider identifier.
 * @param options - Conversion options.
 * @returns The provider-specific tool object and a transformation report.
 */
function bridgeTool(
  tool: ToolDefinition,
  provider: Provider,
  options?: Partial<BridgeOptions>,
): BridgeToolResult;

/**
 * Convert an array of tool definitions to provider-specific format.
 *
 * @param tools - Array of provider-agnostic tool definitions.
 * @param provider - Target provider identifier.
 * @param options - Conversion options.
 * @returns Provider-specific tool objects and per-tool transformation reports.
 */
function bridgeTools(
  tools: ToolDefinition[],
  provider: Provider,
  options?: Partial<BridgeOptions>,
): BridgeToolsResult;
```

---

## 8. Tool Definition Bridging

### Purpose

Tool definitions are more than schemas. Each provider expects a specific object structure wrapping the schema with metadata (name, description) and provider-specific fields (OpenAI's `strict`, Gemini's `functionDeclarations` array, MCP's `inputSchema`/`outputSchema`). `bridgeTool` handles this wrapping so the caller gets a ready-to-use object for any provider's SDK.

### Input Format

The input is a `ToolDefinition` object:

```typescript
const tool: ToolDefinition = {
  name: 'search_documents',
  description: 'Search internal documents by query',
  schema: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results'),
    filters: z.object({
      dateAfter: z.string().optional(),
      author: z.string().optional(),
    }).optional(),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      title: z.string(),
      snippet: z.string(),
      score: z.number(),
    })),
    totalCount: z.number(),
  }),
};
```

### Output Per Provider

**OpenAI:**

```json
{
  "type": "function",
  "function": {
    "name": "search_documents",
    "description": "Search internal documents by query",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "Search query" },
        "limit": { "type": ["integer", "null"], "description": "Max results" },
        "filters": {
          "type": ["object", "null"],
          "properties": {
            "dateAfter": { "type": ["string", "null"] },
            "author": { "type": ["string", "null"] }
          },
          "required": ["dateAfter", "author"],
          "additionalProperties": false
        }
      },
      "required": ["query", "limit", "filters"],
      "additionalProperties": false
    },
    "strict": true
  }
}
```

Note: `minimum`/`maximum` constraints on `limit` are removed. The `outputSchema` is ignored (OpenAI does not support it on tool definitions). Optional fields (`limit`, `filters`, `dateAfter`, `author`) are made required but nullable.

**Anthropic:**

```json
{
  "name": "search_documents",
  "description": "Search internal documents by query",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query" },
      "limit": { "type": "integer", "minimum": 1, "maximum": 100, "description": "Max results" },
      "filters": {
        "type": "object",
        "properties": {
          "dateAfter": { "type": "string" },
          "author": { "type": "string" }
        }
      }
    },
    "required": ["query"]
  }
}
```

Note: `input_schema` wrapper (not `parameters`). Constraints preserved. Optional fields remain optional. `outputSchema` ignored.

**MCP:**

```json
{
  "name": "search_documents",
  "description": "Search internal documents by query",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query" },
      "limit": { "type": "integer", "minimum": 1, "maximum": 100, "description": "Max results" },
      "filters": {
        "type": "object",
        "properties": {
          "dateAfter": { "type": "string" },
          "author": { "type": "string" }
        }
      }
    },
    "required": ["query"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "results": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "snippet": { "type": "string" },
            "score": { "type": "number" }
          },
          "required": ["title", "snippet", "score"]
        }
      },
      "totalCount": { "type": "number" }
    },
    "required": ["results", "totalCount"]
  }
}
```

Note: `inputSchema` (camelCase). Both `inputSchema` and `outputSchema` are included. Full JSON Schema preserved.

### Metadata Preservation

Tool metadata -- `name` and `description` -- is passed through unchanged to all providers. The `name` must be a valid identifier (alphanumeric and underscores). If the name contains invalid characters, `bridgeTool` throws a `TypeError` synchronously rather than producing a tool definition that will be rejected by the provider.

### Output Schema Handling

Only MCP supports `outputSchema` on tool definitions. For all other providers, the `outputSchema` field from the input `ToolDefinition` is ignored, and the transformation report includes an `info`-level note documenting the omission. The caller can still use the output schema with `tool-output-guard` for runtime validation, even if the provider does not include it in the tool definition.

---

## 9. Transformation Report

### Purpose

The transformation report is the diagnostic output of every bridge operation. It serves two purposes: auditing (what did `schema-bridge` change and why?) and debugging (why is my schema not working with this provider?).

### Reading the Report

```typescript
import { bridge } from 'schema-bridge';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).max(150),
  email: z.string().email().optional(),
  tags: z.array(z.string()).max(10).optional(),
});

const { schema: openaiSchema, report } = bridge(schema, 'openai');

console.log(report.sourceFormat);          // 'zod'
console.log(report.targetProvider);        // 'openai'
console.log(report.hasLossyTransformations); // true (min/max constraints removed)

console.log(report.summary);
// {
//   totalTransformations: 12,
//   losslessCount: 6,
//   lossyCount: 6,
//   keywordsRemoved: 6,
//   refsInlined: 0,
//   fieldsMadeNullable: 2
// }

for (const warning of report.warnings) {
  console.warn(`[${warning.severity}] ${warning.path}: ${warning.message}`);
}
// [warning] $.properties.name: Removed 'minLength: 1' (not supported by OpenAI strict mode)
// [warning] $.properties.name: Removed 'maxLength: 100' (not supported by OpenAI strict mode)
// [warning] $.properties.age: Removed 'minimum: 0' (not supported by OpenAI strict mode)
// [warning] $.properties.age: Removed 'maximum: 150' (not supported by OpenAI strict mode)
// [warning] $.properties.email: Removed 'format: email' (not supported by OpenAI strict mode)
// [warning] $.properties.tags: Removed 'maxItems: 10' (not supported by OpenAI strict mode)

for (const t of report.transformations) {
  console.log(`${t.type} at ${t.path} — ${t.description}`);
}
// ADDITIONAL_PROPERTIES_INJECTED at $ — Added additionalProperties: false
// REQUIRED_EXPANDED at $ — Added 'email' to required array
// FIELD_MADE_NULLABLE at $.properties.email — Changed type from 'string' to ['string', 'null']
// REQUIRED_EXPANDED at $ — Added 'tags' to required array
// FIELD_MADE_NULLABLE at $.properties.tags — Changed type from array to nullable array
// KEYWORD_REMOVED at $.properties.name — Removed minLength: 1
// KEYWORD_REMOVED at $.properties.name — Removed maxLength: 100
// ...
```

### Compatibility Assessment

The report includes a `validation` field that checks the transformed schema against the target provider's known constraints:

```typescript
console.log(report.validation);
// { valid: true, errors: [] }

// If the schema exceeds OpenAI's 100-property limit:
// { valid: false, errors: ['Schema has 127 properties, exceeding OpenAI limit of 100'] }
```

This catches errors at build time, before the schema is sent to the provider's API.

---

## 10. Input Schema Formats

### Zod Schemas

Zod is the recommended input format for TypeScript projects. `schema-bridge` supports both Zod v3 and Zod v4.

**Zod v4 (preferred):** Uses the native `z.toJSONSchema()` method for conversion. Supports targeting different JSON Schema drafts, metadata via `z.globalRegistry`, and handling of unrepresentable types.

**Zod v3:** Uses the `zod-to-json-schema` package for conversion. This package is a peer dependency and must be installed separately. It supports OpenAI strict mode schemas (optional properties converted to required nullable), `$ref`/`$defs` for recursive schemas, and targeting legacy OpenAPI 3.0.

**Zod types and their JSON Schema mappings:**

| Zod Type | JSON Schema | Notes |
|---|---|---|
| `z.string()` | `{ "type": "string" }` | |
| `z.number()` | `{ "type": "number" }` | |
| `z.number().int()` | `{ "type": "integer" }` | |
| `z.boolean()` | `{ "type": "boolean" }` | |
| `z.null()` | `{ "type": "null" }` | |
| `z.literal("x")` | `{ "const": "x" }` | |
| `z.enum(["a", "b"])` | `{ "type": "string", "enum": ["a", "b"] }` | |
| `z.object({...})` | `{ "type": "object", "properties": {...} }` | |
| `z.array(T)` | `{ "type": "array", "items": T }` | |
| `z.tuple([A, B])` | `{ "type": "array", "prefixItems": [A, B] }` | draft-2020-12 |
| `z.union([A, B])` | `{ "anyOf": [A, B] }` | |
| `z.discriminatedUnion(...)` | `{ "anyOf": [...] }` with discriminator | |
| `z.intersection(A, B)` | `{ "allOf": [A, B] }` | |
| `z.record(K, V)` | `{ "type": "object", "additionalProperties": V }` | Lossy for OpenAI strict mode |
| `z.optional()` | Property omitted from `required` | |
| `z.nullable()` | `{ "anyOf": [T, {"type": "null"}] }` or `"type": [T, "null"]` | |
| `z.default(val)` | `{ "default": val }` | Removed for some providers |
| `z.describe("text")` | `{ "description": "text" }` | |

**Zod types that do not map to JSON Schema:**

| Zod Type | Behavior |
|---|---|
| `z.transform()` | Conversion uses the input type schema, not the output type. The transform function is a runtime operation with no JSON Schema equivalent. |
| `z.refine()` / `z.superRefine()` | Refinements are runtime-only validations. The base type is used for JSON Schema; the refinement is lost. |
| `z.pipe()` | The input type of the pipe is used. The piped transformation is runtime-only. |
| `z.brand()` | Branding is a TypeScript-only concept. The underlying type is used for JSON Schema. |
| `z.catch()` | The catch value is a runtime fallback. The underlying type is used for JSON Schema. |
| `z.lazy()` | Produces a `$ref`/`$defs` recursive reference in JSON Schema. |
| `z.promise()` | Not representable in JSON Schema. Treated as the resolved type. |
| `z.function()` | Not representable in JSON Schema. Throws during conversion. |
| `z.void()` / `z.undefined()` / `z.never()` | Not representable in JSON Schema. Handled via the `unrepresentable` option (`"throw"` or `"any"`). |

### JSON Schema Objects

`schema-bridge` accepts JSON Schema objects conforming to draft-07, draft-2020-12, or OpenAPI 3.0/3.1. The draft version is auto-detected from the `$schema` property if present, or assumed to be draft-2020-12 if absent.

**Draft differences handled:**

| Feature | draft-07 | draft-2020-12 |
|---|---|---|
| Definitions location | `definitions` | `$defs` |
| Tuple items | `items` (array form) | `prefixItems` + `items` (single) |
| Nullable type | `"type": ["string", "null"]` | `"type": ["string", "null"]` |
| If/then/else | Supported | Supported |

`schema-bridge` normalizes draft-07 features to draft-2020-12 equivalents during internal processing (e.g., `definitions` is renamed to `$defs`, array-form `items` is converted to `prefixItems`).

### TypeBox Schemas

TypeBox schemas are JSON Schema objects with static TypeScript type inference. They are detected by the `Symbol.for('TypeBox.Kind')` property and processed identically to JSON Schema objects. No special handling is needed.

```typescript
import { Type } from '@sinclair/typebox';
import { bridge } from 'schema-bridge';

const WeatherSchema = Type.Object({
  temperature: Type.Number({ minimum: -100, maximum: 60 }),
  conditions: Type.String(),
});

const { schema } = bridge(WeatherSchema, 'openai');
```

### Auto-Detection

Schema format is auto-detected using the following checks, applied in order:

| Check | Detected Format |
|---|---|
| Has `_def` property and `safeParse` method | Zod v3 |
| Has `~standard` property (Zod v4's standard schema interface) | Zod v4 |
| Has `Symbol.for('TypeBox.Kind')` symbol | TypeBox (treated as JSON Schema) |
| Has `type` property or `$schema` property | JSON Schema |

Detection is performed once when `bridge` is called, not on every invocation if caching is active. If the schema does not match any known format, a `TypeError` is thrown synchronously.

---

## 11. Configuration

### Global Defaults

`schema-bridge` exports a `configure` function for setting global defaults:

```typescript
import { configure } from 'schema-bridge';

configure({
  strict: true,
  promoteConstraintsToDescription: true,
  validate: true,
  maxRecursionDepth: 5,
});
```

Global defaults are overridden by per-call options.

### Per-Provider Defaults

Provider-specific defaults can be set independently:

```typescript
import { configure } from 'schema-bridge';

configure({
  providers: {
    openai: { strict: true, schemaName: 'response' },
    anthropic: { strict: false },
    gemini: { targetDraft: 'openapi-3.0' },
  },
});
```

### Strict vs Lenient Mode

The `strict` option controls whether provider-specific strictness requirements are applied:

- **`strict: true` (default):** Apply all strictness requirements for the target provider. For OpenAI, this means `additionalProperties: false`, required expansion, and nullable conversion. For Anthropic with the structured output beta, this means `additionalProperties: false`. For other providers, strictness has minimal effect.
- **`strict: false`:** Apply minimal transformations. Schema wrapper keys and envelope formats are still applied (these are structural requirements, not strictness requirements), but strictness-specific changes (required expansion, `additionalProperties` injection) are skipped. Use this when you want the schema in the provider's envelope format but do not need strict mode guarantees.

### Custom Transformations

The `customTransforms` option allows injecting custom transformation functions into the pipeline:

```typescript
const result = bridge(schema, 'openai', {
  customTransforms: [
    // Add a custom keyword to all string fields
    (schema, provider) => {
      walkSchema(schema, (node, path) => {
        if (node.type === 'string' && !node.description) {
          node.description = `String field at ${path}`;
        }
      });
      return schema;
    },
  ],
});
```

Custom transforms run after all provider-specific transforms and before validation.

---

## 12. Validation

### Provider-Specific Validation

After applying transformations, `schema-bridge` validates the output schema against the target provider's known constraints. Validation catches errors that would otherwise surface as 400 errors from the provider's API.

**OpenAI validation checks:**

| Check | Error |
|---|---|
| Total properties > 100 | `Schema has {n} properties, exceeding OpenAI limit of 100` |
| Nesting depth > 5 | `Schema nesting depth is {n}, exceeding OpenAI limit of 5` |
| Total enum values > 500 | `Schema has {n} total enum values, exceeding OpenAI limit of 500` |
| Combined enum/const character count > 15,000 | `Combined enum/const values exceed OpenAI 15,000 character limit` |
| Missing `additionalProperties: false` on any object (strict mode) | `Object at {path} missing additionalProperties: false` |
| Property in `properties` not in `required` (strict mode) | `Property {name} at {path} not in required array` |
| Unsupported root type | `Root schema must be an object type for OpenAI structured output` |

**Gemini validation checks:**

| Check | Error |
|---|---|
| Schema complexity heuristic | `Schema complexity score {n} may exceed Gemini limits` |
| Unsupported keywords present | `Keyword {keyword} at {path} may not be supported by Gemini` |

**General validation checks (all providers):**

| Check | Error |
|---|---|
| Schema is not a valid object | `Schema must be a plain object` |
| Missing `type` on root | `Root schema missing type property` |

Validation results are included in the `TransformationReport`. If `validate: false` is set, validation is skipped.

---

## 13. Testing Strategy

### Unit Tests

Each provider adapter is tested independently with a comprehensive suite of schemas covering:

- Simple object schemas (flat properties, all required).
- Schemas with optional fields (testing required expansion for OpenAI).
- Nested object schemas (testing recursive `additionalProperties` injection).
- Schemas with `$ref`/`$defs` (testing inlining for providers without support, preservation for providers with support).
- Recursive schemas (self-referencing types, testing cycle detection).
- Schemas with `anyOf`/`oneOf`/`allOf` (testing simplification).
- Schemas with constraints (`minimum`, `pattern`, `format`) testing keyword removal.
- Schemas with `z.record()` and `additionalProperties` schemas (testing lossy conversion).
- Edge cases: empty objects, single-property objects, deeply nested schemas, schemas at provider limits (exactly 100 properties, exactly 5 levels deep).

### Snapshot Tests

Golden-file snapshot tests for each provider capture the exact JSON output for a set of canonical schemas. When the transformation logic changes, snapshot diffs make the impact immediately visible.

### Round-Trip Tests

For providers where the output can be parsed back to a generic schema, round-trip tests verify that: source Zod schema -> bridge to provider -> extract schema from provider format -> structurally equivalent to the canonical JSON Schema (modulo provider-specific additions like `additionalProperties: false`).

### Provider API Contract Tests

Integration tests (gated behind environment variables for API keys) submit the bridged tool definitions to each provider's actual API and verify that the API accepts them without errors. These tests do not validate model output -- they validate that the schema format is accepted.

### Transformation Report Tests

Tests verify that the transformation report accurately documents every change:

- Each transformation has the correct `type`, `path`, and `lossy` flag.
- Warnings are generated for all lossy transformations.
- The summary counts match the transformation list.
- Validation catches known constraint violations.

### Zod Version Compatibility Tests

Separate test suites for Zod v3 and Zod v4 schemas ensure that both versions produce correct output. Tests verify that v3 (via `zod-to-json-schema`) and v4 (via native `z.toJSONSchema()`) produce structurally equivalent canonical JSON Schema for the same logical schema definition.

---

## 14. Performance

### Transformation Speed

Schema transformations are synchronous, in-memory operations on plain JavaScript objects. No I/O, no async operations, no external calls. Typical transformation times:

| Schema Complexity | Expected Time |
|---|---|
| Simple (5-10 properties, no nesting) | < 0.1 ms |
| Medium (20-30 properties, 2-3 levels deep) | < 0.5 ms |
| Complex (50+ properties, 4-5 levels, `$ref`/`$defs`) | < 2 ms |
| At OpenAI limit (100 properties, 5 levels) | < 5 ms |

### Caching

`schema-bridge` caches transformation results. The cache key is derived from the canonical JSON Schema (deep hash), the target provider, and the options. Cache hits return in < 0.01 ms.

**Cache invalidation:** The cache uses a WeakMap keyed on the source schema object when the source is a Zod or TypeBox schema (garbage collection handles eviction). For JSON Schema objects, a structural hash is computed and stored in a bounded LRU cache (default: 1000 entries).

**Cache bypass:** Set `cache: false` in options to force recomputation.

### Zod-to-JSON-Schema Conversion

The Zod-to-JSON-Schema conversion step (for Zod input schemas) is the most expensive part of the pipeline. For Zod v4, the native `z.toJSONSchema()` is fast (< 1 ms for most schemas). For Zod v3 with `zod-to-json-schema`, conversion can take 1-5 ms for complex schemas. This cost is incurred only on the first conversion; subsequent calls for the same Zod schema use the cached canonical JSON Schema.

### Memory

Schema transformations produce new objects (they do not mutate the input). Memory usage is proportional to the schema size. A schema with 100 properties and 5 levels of nesting produces an output object of approximately 10-50 KB. The cache stores both the canonical JSON Schema and the per-provider outputs, so memory usage scales linearly with the number of unique schemas multiplied by the number of target providers.

---

## 15. Dependencies

### Runtime Dependencies

None. The core conversion logic uses only built-in JavaScript APIs (`JSON.parse`, `JSON.stringify`, `structuredClone`, `Object.keys`, `Array.isArray`). No runtime npm dependencies.

### Peer Dependencies

| Dependency | When Required | Version |
|---|---|---|
| `zod` | When using Zod schemas as input | `^3.0.0 \|\| ^4.0.0` |
| `zod-to-json-schema` | When using Zod v3 schemas (Zod v4 has native conversion) | `^3.0.0` |

Both peer dependencies are optional. If the caller only uses JSON Schema or TypeBox as input, neither is needed. If the caller uses Zod v4, only `zod` is needed. If the caller uses Zod v3, both `zod` and `zod-to-json-schema` are needed.

### Development Dependencies

| Dependency | Purpose |
|---|---|
| `typescript` | Compilation |
| `vitest` | Test runner |
| `eslint` | Linting |
| `zod` | Testing Zod schema conversion |
| `zod-to-json-schema` | Testing Zod v3 conversion path |
| `@sinclair/typebox` | Testing TypeBox schema input |

---

## 16. File Structure

```
schema-bridge/
├── src/
│   ├── index.ts                    # Public API exports
│   ├── bridge.ts                   # bridge() function, schema detection, orchestration
│   ├── bridge-tool.ts              # bridgeTool() and bridgeTools() functions
│   ├── configure.ts                # Global configuration
│   ├── types.ts                    # TypeScript type definitions
│   ├── canonical.ts                # Normalize input to canonical JSON Schema
│   ├── detect.ts                   # Auto-detect schema format (Zod, JSON Schema, TypeBox)
│   ├── cache.ts                    # Transformation result cache
│   ├── report.ts                   # TransformationReport builder
│   ├── walk.ts                     # JSON Schema tree walker utility
│   ├── validate.ts                 # Provider-specific output validation
│   ├── transforms/
│   │   ├── index.ts                # Transform pipeline orchestration
│   │   ├── inject-additional-properties.ts
│   │   ├── expand-required.ts
│   │   ├── inline-refs.ts
│   │   ├── simplify-composition.ts
│   │   ├── remove-keywords.ts
│   │   ├── promote-to-description.ts
│   │   ├── handle-recursive.ts
│   │   └── handle-defaults.ts
│   ├── adapters/
│   │   ├── index.ts                # Adapter registry
│   │   ├── openai.ts               # OpenAI adapter
│   │   ├── anthropic.ts            # Anthropic adapter
│   │   ├── gemini.ts               # Gemini adapter
│   │   ├── mcp.ts                  # MCP adapter
│   │   ├── cohere.ts               # Cohere adapter
│   │   └── ollama.ts               # Ollama adapter
│   └── __tests__/
│       ├── bridge.test.ts           # Core bridge function tests
│       ├── bridge-tool.test.ts      # Tool definition bridging tests
│       ├── detect.test.ts           # Schema format detection tests
│       ├── canonical.test.ts        # Canonicalization tests
│       ├── cache.test.ts            # Caching tests
│       ├── report.test.ts           # Report generation tests
│       ├── validate.test.ts         # Provider validation tests
│       ├── transforms/
│       │   ├── inject-additional-properties.test.ts
│       │   ├── expand-required.test.ts
│       │   ├── inline-refs.test.ts
│       │   ├── simplify-composition.test.ts
│       │   ├── remove-keywords.test.ts
│       │   └── handle-recursive.test.ts
│       ├── adapters/
│       │   ├── openai.test.ts
│       │   ├── anthropic.test.ts
│       │   ├── gemini.test.ts
│       │   ├── mcp.test.ts
│       │   ├── cohere.test.ts
│       │   └── ollama.test.ts
│       └── snapshots/
│           ├── openai/              # Golden-file snapshots per provider
│           ├── anthropic/
│           ├── gemini/
│           ├── mcp/
│           ├── cohere/
│           └── ollama/
├── package.json
├── tsconfig.json
├── SPEC.md
└── README.md
```

---

## 17. Implementation Roadmap

### Phase 1: Core Infrastructure

1. Implement schema format detection (`detect.ts`): Zod v3, Zod v4, JSON Schema, TypeBox.
2. Implement canonical conversion (`canonical.ts`): Zod-to-JSON-Schema via `z.toJSONSchema()` (v4) and `zod-to-json-schema` (v3), JSON Schema normalization (draft-07 to draft-2020-12), TypeBox pass-through.
3. Implement schema tree walker (`walk.ts`): depth-first traversal with path tracking, used by all transforms.
4. Implement transformation report builder (`report.ts`).
5. Implement type definitions (`types.ts`).

### Phase 2: Transforms

6. Implement `inline-refs.ts`: `$ref`/`$defs` resolution with cycle detection.
7. Implement `inject-additional-properties.ts`: recursive `additionalProperties: false` injection.
8. Implement `expand-required.ts`: required array expansion with nullable conversion.
9. Implement `remove-keywords.ts`: per-provider keyword removal.
10. Implement `promote-to-description.ts`: append removed constraints to descriptions.
11. Implement `simplify-composition.ts`: `oneOf`/`anyOf`/`allOf` simplification.
12. Implement `handle-recursive.ts`: recursive schema detection and handling.
13. Implement `handle-defaults.ts`: default value handling.
14. Implement transform pipeline orchestration (`transforms/index.ts`).

### Phase 3: Provider Adapters

15. Implement OpenAI adapter: strict mode transforms, response format envelope, function tool format.
16. Implement Anthropic adapter: `input_schema` wrapping, optional strict mode.
17. Implement Gemini adapter: `responseSchema` wrapping, `functionDeclarations` format, optional type constant uppercasing.
18. Implement MCP adapter: `inputSchema`/`outputSchema` wrapping, minimal transforms.
19. Implement Cohere adapter: tool format wrapping.
20. Implement Ollama adapter: `format` field wrapping, `$ref` inlining for compatibility.

### Phase 4: High-Level API

21. Implement `bridge()` function and per-provider convenience methods (`bridge.ts`).
22. Implement `bridgeTool()` and `bridgeTools()` (`bridge-tool.ts`).
23. Implement provider-specific output validation (`validate.ts`).
24. Implement caching (`cache.ts`).
25. Implement global configuration (`configure.ts`).

### Phase 5: Testing and Documentation

26. Write unit tests for each transform.
27. Write unit tests for each adapter.
28. Write integration tests for `bridge`, `bridgeTool`, `bridgeTools`.
29. Write snapshot tests with golden files for all providers.
30. Write provider API contract tests (gated behind environment variables).
31. Write Zod v3/v4 compatibility tests.
32. Write README with usage examples.

---

## 18. Example Use Cases

### Multi-Provider Tool Deployment

An application that supports OpenAI, Anthropic, and Gemini, and lets the user choose their provider:

```typescript
import { bridgeTools } from 'schema-bridge';
import { z } from 'zod';

const tools = [
  {
    name: 'search',
    description: 'Search the web',
    schema: z.object({
      query: z.string().describe('Search query'),
      maxResults: z.number().int().min(1).max(50).optional().describe('Maximum results to return'),
    }),
  },
  {
    name: 'get_weather',
    description: 'Get weather for a location',
    schema: z.object({
      location: z.string().describe('City name'),
      units: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature units'),
    }),
  },
];

function getProviderTools(provider: 'openai' | 'anthropic' | 'gemini') {
  const { tools: providerTools, reports } = bridgeTools(tools, provider);

  // Log any lossy transformations
  for (const report of reports) {
    if (report.hasLossyTransformations) {
      console.warn(`Lossy transformations for ${report.targetProvider}:`,
        report.warnings.map(w => w.message));
    }
  }

  return providerTools;
}

// OpenAI: [{ type: "function", function: { name, description, parameters, strict: true } }, ...]
const openaiTools = getProviderTools('openai');

// Anthropic: [{ name, description, input_schema }, ...]
const anthropicTools = getProviderTools('anthropic');

// Gemini: [{ functionDeclarations: [{ name, description, parameters }, ...] }]
const geminiTools = getProviderTools('gemini');
```

### OpenAI Strict Mode Conversion

Converting a complex schema with constraints, optional fields, and nested objects for OpenAI strict mode:

```typescript
import { bridge } from 'schema-bridge';
import { z } from 'zod';

const OrderSchema = z.object({
  orderId: z.string().uuid(),
  customer: z.object({
    name: z.string().min(1).max(200),
    email: z.string().email(),
    phone: z.string().optional(),
  }),
  items: z.array(z.object({
    sku: z.string(),
    quantity: z.number().int().min(1),
    price: z.number().min(0),
  })),
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string().length(2).optional(),
    zip: z.string().regex(/^\d{5}$/),
    country: z.string().default('US'),
  }).optional(),
  notes: z.string().optional(),
});

const { schema, report } = bridge(OrderSchema, 'openai');

// schema is now:
// - additionalProperties: false on every object (root, customer, items[*], shippingAddress)
// - All fields in required arrays (phone, state, shippingAddress, notes added)
// - Optional fields made nullable (phone, state, shippingAddress, notes)
// - Constraints removed (min, max, uuid, email, regex, length, default)
// - Constraints promoted to descriptions (if promoteConstraintsToDescription: true)

// report.summary:
// { totalTransformations: ~25, losslessCount: ~10, lossyCount: ~15, ... }
```

### Provider Migration Audit

Auditing what changes when migrating tool definitions from Anthropic to OpenAI:

```typescript
import { bridge } from 'schema-bridge';

// Existing Anthropic tool schema (JSON Schema)
const existingSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 1 },
    filters: {
      type: 'object',
      properties: {
        dateRange: {
          type: 'object',
          properties: {
            start: { type: 'string', format: 'date' },
            end: { type: 'string', format: 'date' },
          },
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 10,
        },
      },
    },
  },
  required: ['query'],
};

// Convert to OpenAI strict mode
const { report } = bridge(existingSchema, 'openai');

// The report shows exactly what needs to change:
for (const warning of report.warnings) {
  console.log(`${warning.severity}: ${warning.message}`);
}
// warning: Removed 'minLength: 1' at $.properties.query
// warning: Removed 'format: date' at $.properties.filters.properties.dateRange.properties.start
// warning: Removed 'format: date' at $.properties.filters.properties.dateRange.properties.end
// warning: Removed 'maxItems: 10' at $.properties.filters.properties.categories
// info: Made 'filters' nullable (was optional, now required+nullable)
// info: Made 'dateRange' nullable (was optional, now required+nullable)
// info: Made 'categories' nullable (was optional, now required+nullable)
```

### MCP Server with Multi-Provider Compatibility

An MCP server that generates tool definitions compatible with all providers:

```typescript
import { bridgeTool } from 'schema-bridge';
import { z } from 'zod';

const dbQueryTool = {
  name: 'query_database',
  description: 'Execute a read-only SQL query against the database',
  schema: z.object({
    sql: z.string().describe('The SQL query to execute'),
    parameters: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
      .describe('Parameterized query values'),
    timeout: z.number().int().min(100).max(30000).optional()
      .describe('Query timeout in milliseconds'),
  }),
  outputSchema: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.unknown())),
    rowCount: z.number().int(),
    executionTimeMs: z.number(),
  }),
};

// Generate for MCP (preserves outputSchema)
const mcp = bridgeTool(dbQueryTool, 'mcp');
// mcp.tool has both inputSchema and outputSchema

// Generate for each provider (outputSchema ignored)
const openai = bridgeTool(dbQueryTool, 'openai');
const anthropic = bridgeTool(dbQueryTool, 'anthropic');
const gemini = bridgeTool(dbQueryTool, 'gemini');

// All four are ready to pass to their respective SDKs
```
