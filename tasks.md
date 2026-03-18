# schema-bridge — Task Breakdown

This file tracks all tasks required to implement the `schema-bridge` package per SPEC.md.

---

## Phase 1: Project Scaffolding & Core Types

- [ ] **Install dev dependencies** — Add `typescript`, `vitest`, `eslint`, `zod`, `zod-to-json-schema`, and `@sinclair/typebox` as devDependencies. Add `zod` and `zod-to-json-schema` as optional peerDependencies with the version ranges specified in the spec (`zod: ^3.0.0 || ^4.0.0`, `zod-to-json-schema: ^3.0.0`). Verify `npm install` succeeds and `npm run build` produces output. | Status: not_done

- [ ] **Define TypeScript types (`src/types.ts`)** — Create the `types.ts` file with all type definitions from the spec: `Provider` (union of `'openai' | 'anthropic' | 'gemini' | 'mcp' | 'cohere' | 'ollama'`), `InputSchema`, `JSONSchemaObject` (with all JSON Schema keywords as properties), `BridgeOptions` (with `strict`, `promoteConstraintsToDescription`, `maxRecursionDepth`, `schemaName`, `targetDraft`, `validate`, `customTransforms`, `cache`), `ToolDefinition` (with `name`, `description`, `schema`, optional `outputSchema`), `BridgeResult`, `BridgeToolResult`, `BridgeToolsResult`, `TransformationReport`, `TransformationRecord`, `TransformationType` (all 11 types), `TransformationWarning`. | Status: not_done

- [ ] **Set up public API exports (`src/index.ts`)** — Replace the placeholder `export {}` with exports for `bridge`, `bridgeTool`, `bridgeTools`, `configure`, and all public types. This file will be updated as each module is implemented, but the structure should be set up now. | Status: not_done

- [ ] **Configure vitest** — Add a `vitest.config.ts` (or configure in `package.json`) to set up the test runner. Ensure `npm run test` works (even if no tests exist yet). | Status: not_done

- [ ] **Configure ESLint** — Add an ESLint config file suitable for TypeScript. Ensure `npm run lint` works against the `src/` directory. | Status: not_done

---

## Phase 2: Schema Detection & Canonicalization

- [ ] **Implement schema format auto-detection (`src/detect.ts`)** — Create a `detectSchemaFormat` function that accepts an `InputSchema` and returns the detected format: `'zod-v3'`, `'zod-v4'`, `'typebox'`, or `'json-schema'`. Detection order per spec: (1) check for `_def` property and `safeParse` method -> Zod v3, (2) check for `~standard` property -> Zod v4, (3) check for `Symbol.for('TypeBox.Kind')` -> TypeBox, (4) check for `type` or `$schema` property -> JSON Schema. Throw `TypeError` synchronously if no format matches. | Status: not_done

- [ ] **Implement canonical JSON Schema conversion (`src/canonical.ts`)** — Create a `toCanonical` function that converts any `InputSchema` to a canonical `JSONSchemaObject` (draft-2020-12). For Zod v4, use native `z.toJSONSchema()`. For Zod v3, use the `zod-to-json-schema` package. For TypeBox, pass through directly (TypeBox schemas are already JSON Schema). For JSON Schema, normalize draft-07 features to draft-2020-12 (rename `definitions` to `$defs`, convert array-form `items` to `prefixItems`). Handle missing peer dependencies gracefully by throwing a clear error message (e.g., "zod-to-json-schema is required for Zod v3 schemas"). | Status: not_done

- [ ] **Implement draft-07 to draft-2020-12 normalization** — Within `canonical.ts`, implement the normalization logic that converts draft-07 features: `definitions` -> `$defs`, array-form `items` -> `prefixItems` + single `items`, handle `$schema` property differences. Auto-detect the draft version from the `$schema` property if present. | Status: not_done

- [ ] **Implement schema tree walker (`src/walk.ts`)** — Create a `walkSchema` utility function that performs depth-first traversal of a JSON Schema tree with JSON path tracking. The walker should visit nodes inside `properties`, `items`, `prefixItems`, `anyOf`, `oneOf`, `allOf`, `not`, `$defs`, `definitions`, `additionalProperties` (when it's a schema object), and `if`/`then`/`else`. Provide both a visitor-pattern API (callback per node) and a map/transform API (return a modified node). This utility is used by all transforms. | Status: not_done

---

## Phase 3: Transformation Report & Validation Infrastructure

- [ ] **Implement transformation report builder (`src/report.ts`)** — Create a `ReportBuilder` class (or factory function) that accumulates `TransformationRecord` entries and `TransformationWarning` entries during a bridge operation. Provide methods: `addTransformation(record)`, `addWarning(warning)`, `build()` -> `TransformationReport`. The `build` method should compute `hasLossyTransformations`, populate `summary` (totalTransformations, losslessCount, lossyCount, keywordsRemoved, refsInlined, fieldsMadeNullable), and set `sourceFormat` and `targetProvider`. Summary counts must match the transformation list. | Status: not_done

- [ ] **Implement provider-specific output validation (`src/validate.ts`)** — Create a `validateForProvider` function that checks a transformed JSON Schema against a provider's known constraints. Implement OpenAI checks: total properties > 100, nesting depth > 5, total enum values > 500, combined enum/const character count > 15000, missing `additionalProperties: false` on any object (strict mode), property in `properties` not in `required` (strict mode), unsupported root type (must be object). Implement Gemini checks: schema complexity heuristic, unsupported keywords warning. Implement general checks for all providers: schema must be a plain object, root schema should have a `type` property. Return `{ valid: boolean, errors: string[] }`. | Status: not_done

---

## Phase 4: Individual Transforms

- [ ] **Implement `$ref`/`$defs` inlining (`src/transforms/inline-refs.ts`)** — Create an `inlineRefs` transform function. Walk the schema tree, collect all `$defs`/`definitions` entries, resolve each `$ref` pointer to its definition, replace `$ref` nodes with deep clones of the referenced definition. After all refs are resolved, remove the `$defs` block if no references remain. For non-recursive refs, this is straightforward inlining. Record each inlining as a `REF_INLINED` transformation. Support both `#/$defs/Name` and `#/definitions/Name` pointer formats. | Status: not_done

- [ ] **Implement cycle detection for recursive schemas (`src/transforms/handle-recursive.ts`)** — Create a `handleRecursive` function that detects self-referencing schemas (cycles in `$ref` resolution). Track visited refs during inlining. When a cycle is detected: for providers that support `$ref`/`$defs` (OpenAI, Anthropic, MCP, Gemini Nov 2025+), preserve the recursive `$ref` with `$defs` at the top level. For OpenAI specifically, hoist any nested `$defs` to the top level. For providers without `$ref` support (Ollama, Cohere, older Gemini), truncate recursion at a configurable depth (default: 5 from `maxRecursionDepth` option), insert empty object schema `{}` at the truncation point, and report a `RECURSIVE_SCHEMA_TRUNCATED` warning with `LOSSY_RECURSIVE_SCHEMA` code. | Status: not_done

- [ ] **Implement `additionalProperties: false` injection (`src/transforms/inject-additional-properties.ts`)** — Create an `injectAdditionalProperties` transform. Walk the schema tree recursively. For every node where `type` is `"object"` or where `properties` is present: if `additionalProperties` is absent or `true`, set it to `false` and record an `ADDITIONAL_PROPERTIES_INJECTED` transformation (lossy: false). If `additionalProperties` is a schema object (e.g., `{ type: "string" }`), replace with `false` and record as lossy (`LOSSY_ADDITIONAL_PROPERTIES` warning). Apply recursively into `properties`, `items`, `anyOf`, `oneOf`, `allOf`, `$defs`. | Status: not_done

- [ ] **Implement `required` array expansion (`src/transforms/expand-required.ts`)** — Create an `expandRequired` transform (OpenAI strict mode). For each object node, compare `properties` keys against the `required` array. For each property in `properties` but not in `required`: add the property name to `required`, then modify the property's schema to accept `null`. If type is a string (e.g., `"type": "string"`), change to `"type": ["string", "null"]`. If property uses `anyOf`/`oneOf`, add `{"type": "null"}` as an option. Record `REQUIRED_EXPANDED` and `FIELD_MADE_NULLABLE` transformations. Apply recursively to nested objects. | Status: not_done

- [ ] **Implement unsupported keyword removal (`src/transforms/remove-keywords.ts`)** — Create a `removeKeywords` transform. Accept a set of keywords to remove (varies by provider). Walk the schema tree and remove each keyword found, recording a `KEYWORD_REMOVED` transformation with `lossy: true`, the keyword name, path, and original value. Per-provider keyword lists from the spec: OpenAI removes `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minLength`, `maxLength`, `minItems`, `maxItems`, `pattern`, `format`, `default`, `examples`, `$comment`. Anthropic removes `$comment`. Gemini removes `default`, `examples`, `$comment`. MCP removes nothing. Cohere removes `$comment`. Ollama removes `examples`, `$comment`. | Status: not_done

- [ ] **Implement constraint promotion to description (`src/transforms/promote-to-description.ts`)** — Create a `promoteToDescription` transform. When `promoteConstraintsToDescription` option is enabled and a validation keyword is being removed, append the constraint info to the field's `description`. For example, change `"description": "User age"` to `"description": "User age (minimum: 0, maximum: 150)"`. If no description exists, create one with just the constraint info. Record a `KEYWORD_PROMOTED_TO_DESCRIPTION` transformation. Handle multiple constraints on the same field by combining them into a single parenthetical. | Status: not_done

- [ ] **Implement `oneOf`/`anyOf`/`allOf` simplification (`src/transforms/simplify-composition.ts`)** — Create a `simplifyComposition` transform. Implement the simplification rules from the spec: (1) `anyOf: [T, {type: "null"}]` -> nullable type (lossless), (2) `oneOf` -> `anyOf` if provider supports `anyOf` but not `oneOf`, (3) `allOf: [S1, S2]` -> merge into single object (combine `properties`, `required`; lossless if no conflicts), (4) `allOf: [{$ref: X}, {properties: ...}]` -> resolve ref then merge, (5) `not: S` -> remove with warning (lossy). For unsupported composition types where no simplification is possible, fall back to the first type with a lossy warning. Record `COMPOSITION_SIMPLIFIED` transformations. | Status: not_done

- [ ] **Implement default value handling (`src/transforms/handle-defaults.ts`)** — Create a `handleDefaults` transform. For providers that do not support `default` (OpenAI, Gemini), remove it from the schema. If `promoteConstraintsToDescription` is enabled, append the default value to the description (e.g., `"description": "Response format (default: json)"`). Record `DEFAULT_REMOVED` transformations. For MCP and Anthropic, preserve `default` as-is. | Status: not_done

- [ ] **Implement transform pipeline orchestration (`src/transforms/index.ts`)** — Create a `runTransforms` function that accepts a canonical JSON Schema, a provider, options, and a report builder, and runs the appropriate transforms in the correct deterministic order for the given provider. The pipeline should: (1) inline `$ref`s, (2) handle recursive schemas, (3) simplify composition, (4) inject `additionalProperties: false` (if applicable), (5) expand `required` (if applicable), (6) remove unsupported keywords, (7) promote constraints to description (if enabled), (8) handle defaults, (9) run custom transforms (if any). Each transform receives the schema and report builder and returns the modified schema. | Status: not_done

---

## Phase 5: Provider Adapters

- [ ] **Implement adapter registry (`src/adapters/index.ts`)** — Create an adapter registry that maps provider names to adapter functions. Each adapter is a pure function: `(canonical: JSONSchemaObject, options: BridgeOptions, report: ReportBuilder) => JSONSchemaObject`. The registry provides `getAdapter(provider: Provider)` which returns the adapter function or throws for unknown providers. | Status: not_done

- [ ] **Implement OpenAI adapter (`src/adapters/openai.ts`)** — The OpenAI adapter runs the transform pipeline with: `$ref` inlining (hoist nested `$defs` to top level, preserve top-level for recursive schemas), `additionalProperties: false` injection, `required` expansion with nullable conversion, keyword removal (all OpenAI-unsupported keywords), composition simplification (no `oneOf`/`allOf`, limited `anyOf`). For tool definitions, wrap in `{ type: "function", function: { name, description, parameters, strict: true } }`. For response format, wrap in `{ response_format: { type: "json_schema", json_schema: { name, schema, strict: true } } }`. Handle `strict: false` option by skipping required expansion and `additionalProperties` injection. | Status: not_done

- [ ] **Implement Anthropic adapter (`src/adapters/anthropic.ts`)** — The Anthropic adapter applies minimal transforms: remove `$comment`. Preserve all JSON Schema features (constraints, `$ref`, composition keywords). For tool definitions, wrap in `{ name, description, input_schema }`. When `strict: true` and using structured output beta, inject `additionalProperties: false`. Do not expand `required` or make optional fields nullable (Anthropic supports truly optional fields). | Status: not_done

- [ ] **Implement Gemini adapter (`src/adapters/gemini.ts`)** — The Gemini adapter: remove `default`, `examples`, `$comment`. Handle `$ref`/`$defs` based on model version (preserve for Nov 2025+ by default, inline for older). Optionally uppercase type constants (`"object"` -> `"OBJECT"`, etc.) based on `targetDraft` or a Gemini-specific option. For response format, wrap in `{ generationConfig: { responseMimeType: "application/json", responseSchema } }`. For tool definitions, wrap in `{ functionDeclarations: [{ name, description, parameters }] }`. Handle nullable fields using `"nullable": true` property. Record `TYPE_CONSTANT_UPPERCASED` transformations if applied. | Status: not_done

- [ ] **Implement MCP adapter (`src/adapters/mcp.ts`)** — The MCP adapter applies minimal transforms (MCP supports full JSON Schema). For tool definitions, wrap in `{ name, description, inputSchema }` (camelCase). MCP uniquely supports `outputSchema` — if the tool definition includes `outputSchema`, convert it and include it in the output. Preserve all JSON Schema features. Remove only `$comment` if present. | Status: not_done

- [ ] **Implement Cohere adapter (`src/adapters/cohere.ts`)** — The Cohere adapter: inline `$ref`/`$defs` for maximum compatibility (limited documentation on Cohere's `$ref` support). Remove `$comment`. For tool definitions, wrap in `{ type: "function", function: { name, description, parameters } }`. Note that `strict_tools` is set on the API call level, not per-tool, so the adapter does not add it to the tool definition. | Status: not_done

- [ ] **Implement Ollama adapter (`src/adapters/ollama.ts`)** — The Ollama adapter: inline `$ref`/`$defs` for maximum compatibility (support varies by Ollama version). Remove `examples`, `$comment`. The schema is passed directly as the `format` field value — no envelope or wrapper beyond that. For tool definitions, the schema goes into the `format` field. Handle recursive schemas by truncating at `maxRecursionDepth` with a warning. | Status: not_done

---

## Phase 6: High-Level API Functions

- [ ] **Implement `bridge()` function (`src/bridge.ts`)** — Create the main `bridge(schema, provider, options?)` function. Steps: (1) detect schema format, (2) convert to canonical JSON Schema, (3) create report builder, (4) run transform pipeline via the provider adapter, (5) run provider-specific validation (if `validate` option is not false), (6) build and return `{ schema, report }`. Handle caching: check cache before processing, store result after processing. Merge global config defaults with per-call options. | Status: not_done

- [ ] **Implement per-provider convenience methods on `bridge`** — Attach convenience methods to the `bridge` function: `bridge.openai(schema, options?)`, `bridge.anthropic(schema, options?)`, `bridge.gemini(schema, options?)`, `bridge.mcp(schema, options?)`, `bridge.cohere(schema, options?)`, `bridge.ollama(schema, options?)`. Each is equivalent to calling `bridge(schema, providerName, options)`. | Status: not_done

- [ ] **Implement `bridge.jsonSchema()` convenience method** — Implement `bridge.jsonSchema(schema)` that converts a Zod or TypeBox schema to standard JSON Schema (draft-2020-12) without any provider-specific transformations. Detect the input format, convert to canonical JSON Schema, and return the result directly. | Status: not_done

- [ ] **Implement `bridgeTool()` function (`src/bridge-tool.ts`)** — Create `bridgeTool(tool, provider, options?)`. Steps: (1) validate tool name (must be alphanumeric + underscores, throw `TypeError` for invalid names), (2) call `bridge()` on the tool's `schema`, (3) wrap the transformed schema in the provider-specific tool definition envelope (OpenAI: `{ type: "function", function: { name, description, parameters, strict } }`, Anthropic: `{ name, description, input_schema }`, Gemini: `{ name, description, parameters }`, MCP: `{ name, description, inputSchema }`, Cohere: `{ type: "function", function: { name, description, parameters } }`, Ollama: `{ name, description, format }`), (4) handle `outputSchema` (convert and include for MCP, ignore for all others with an info-level note in the report), (5) return `{ tool, report }`. | Status: not_done

- [ ] **Implement `bridgeTools()` function (`src/bridge-tool.ts`)** — Create `bridgeTools(tools, provider, options?)`. Iterate over the tools array, call `bridgeTool` for each, collect results. For Gemini, wrap all tools in a single `{ functionDeclarations: [...] }` object rather than returning individual tool objects. Return `{ tools, reports }` where `reports` is an array of per-tool `TransformationReport`s. | Status: not_done

- [ ] **Implement output schema handling for MCP in `bridgeTool`** — When the provider is MCP and the `ToolDefinition` includes `outputSchema`, convert the output schema using `bridge()` with MCP as the provider and include it in the tool definition as `outputSchema`. For all other providers, if `outputSchema` is present, add an info-level note to the report documenting that the output schema was omitted (the provider does not support it). | Status: not_done

---

## Phase 7: Caching

- [ ] **Implement transformation result cache (`src/cache.ts`)** — Create a caching layer. Cache key is derived from: canonical JSON Schema (deep structural hash), target provider, and options. For Zod/TypeBox source schemas (object references), use a `WeakMap` keyed on the source schema object for automatic garbage collection. For JSON Schema objects (plain objects), compute a structural hash (e.g., `JSON.stringify` sorted keys or a fast hash function) and store in a bounded LRU cache (default max: 1000 entries). Cache hits return the stored `BridgeResult` without recomputation. Provide a `cache: false` option to bypass caching. Export a `clearCache()` function for testing. | Status: not_done

---

## Phase 8: Global Configuration

- [ ] **Implement `configure()` function (`src/configure.ts`)** — Create a `configure(options)` function that sets global defaults. Support global-level options (`strict`, `promoteConstraintsToDescription`, `validate`, `maxRecursionDepth`) and per-provider overrides (`providers: { openai: { ... }, anthropic: { ... }, ... }`). Store configuration in a module-level variable. Per-call options override per-provider defaults, which override global defaults. Export a `resetConfig()` function for testing. | Status: not_done

---

## Phase 9: Unit Tests — Schema Detection & Canonicalization

- [ ] **Write tests for schema format detection (`src/__tests__/detect.test.ts`)** — Test detection of: Zod v3 schema (has `_def` and `safeParse`), Zod v4 schema (has `~standard`), TypeBox schema (has `Symbol.for('TypeBox.Kind')`), JSON Schema with `type` property, JSON Schema with `$schema` property, JSON Schema with both. Test that unrecognizable input throws `TypeError`. Test detection order (Zod checks before JSON Schema checks, since Zod objects also have `type`). | Status: not_done

- [ ] **Write tests for canonical conversion (`src/__tests__/canonical.test.ts`)** — Test: Zod v4 schema converts via `z.toJSONSchema()`, Zod v3 schema converts via `zod-to-json-schema`, TypeBox schema passes through, JSON Schema (draft-2020-12) passes through, JSON Schema (draft-07) normalizes `definitions` to `$defs` and array-form `items` to `prefixItems`. Test error on missing `zod-to-json-schema` for Zod v3. Test all Zod type mappings from the spec table (string, number, int, boolean, null, literal, enum, object, array, tuple, union, discriminatedUnion, intersection, record, optional, nullable, default, describe). | Status: not_done

---

## Phase 10: Unit Tests — Individual Transforms

- [ ] **Write tests for `$ref`/`$defs` inlining (`src/__tests__/transforms/inline-refs.test.ts`)** — Test: simple `$ref` pointing to `$defs` is inlined, multiple refs to the same def are each inlined independently (deep clone), nested `$defs` are handled, `#/definitions/X` (draft-07 style) is handled, `$defs` block is removed after all refs resolved, refs inside `properties`, `items`, `anyOf` are resolved. Test that non-recursive refs are fully inlined. | Status: not_done

- [ ] **Write tests for recursive schema handling (`src/__tests__/transforms/handle-recursive.test.ts`)** — Test: self-referencing schema (e.g., tree node with `children: $ref` to self) is detected as recursive. For OpenAI/Anthropic/MCP, `$ref`/`$defs` are preserved. For Ollama/Cohere, recursion is truncated at `maxRecursionDepth` (default 5) with empty object `{}` at truncation point. Test `RECURSIVE_SCHEMA_TRUNCATED` warning is generated. Test custom `maxRecursionDepth` option. Test nested `$defs` are hoisted to top level for OpenAI. | Status: not_done

- [ ] **Write tests for `additionalProperties: false` injection (`src/__tests__/transforms/inject-additional-properties.test.ts`)** — Test: root object gets `additionalProperties: false`, nested objects in `properties` get it, objects inside `items` (arrays) get it, objects inside `anyOf`/`oneOf`/`allOf` get it, objects inside `$defs` get it. Test that existing `additionalProperties: false` is not re-added. Test that `additionalProperties: true` is overwritten to `false`. Test that `additionalProperties: { type: "string" }` is replaced with `false` and recorded as lossy. | Status: not_done

- [ ] **Write tests for `required` expansion (`src/__tests__/transforms/expand-required.test.ts`)** — Test: property in `properties` but not in `required` is added to `required` and made nullable. String type becomes `["string", "null"]`. Number type becomes `["number", "null"]`. Property already using `anyOf` gets `{type: "null"}` added. Property that is already nullable is not double-nullified. Nested objects are expanded recursively. Test that already-required properties are not modified. Test the full before/after example from the spec (name required, nickname optional -> both required, nickname nullable). | Status: not_done

- [ ] **Write tests for keyword removal (`src/__tests__/transforms/remove-keywords.test.ts`)** — Test keyword removal per provider using the spec's keyword table. For OpenAI: verify `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minLength`, `maxLength`, `minItems`, `maxItems`, `pattern`, `format`, `default`, `examples`, `$comment` are removed. Verify `title` and `description` are kept. For Anthropic: only `$comment` removed. For MCP: nothing removed. Verify each removal generates a `KEYWORD_REMOVED` record with `lossy: true`. | Status: not_done

- [ ] **Write tests for constraint promotion to description (`src/__tests__/transforms/promote-to-description.test.ts`)** — Test: when `promoteConstraintsToDescription: true`, removed `minimum: 0` appended to existing description as `"User age (minimum: 0)"`. Multiple constraints combined: `"User age (minimum: 0, maximum: 150)"`. When no description exists, one is created: `"(minimum: 0, maximum: 150)"`. Test that `format`, `pattern`, `default`, `minLength`, `maxLength`, `minItems`, `maxItems` are all promotable. Test that promotion does not occur when option is `false`. | Status: not_done

- [ ] **Write tests for composition simplification (`src/__tests__/transforms/simplify-composition.test.ts`)** — Test: `anyOf: [T, {type: "null"}]` simplified to nullable type (lossless). `oneOf` converted to `anyOf` when provider supports `anyOf` (lossless). `allOf: [S1, S2]` merged into single object. `allOf` with `$ref` resolved and merged. `not: S` removed with lossy warning. Complex `anyOf` with multiple non-null types: preserved if provider supports, or first type used with warning. Test that simplification is recursive (applies to nested nodes). | Status: not_done

---

## Phase 11: Unit Tests — Provider Adapters

- [ ] **Write tests for OpenAI adapter (`src/__tests__/adapters/openai.test.ts`)** — Test: simple flat object with all required fields (no changes needed beyond `additionalProperties`). Object with optional fields (required expansion + nullable). Nested objects (recursive `additionalProperties` injection). Schema with constraints (all removed). Schema with `$ref`/`$defs` (non-recursive: inlined; recursive: preserved at top level). Schema with `anyOf` for nullable (kept). Schema with `oneOf` (simplified/removed). Schema at limits (100 properties, 5 nesting levels). Schema exceeding limits (validation errors). Response format envelope structure. Tool definition structure. `strict: false` mode skips required expansion and `additionalProperties`. | Status: not_done

- [ ] **Write tests for Anthropic adapter (`src/__tests__/adapters/anthropic.test.ts`)** — Test: schema passes through with minimal changes. `input_schema` wrapper key used in tool definitions. Constraints preserved (`minimum`, `maximum`, `pattern`, `format`). Optional fields remain optional (not expanded to required+nullable). `$ref`/`$defs` preserved. `anyOf`/`oneOf`/`allOf` preserved. `$comment` removed. `strict: true` mode adds `additionalProperties: false`. | Status: not_done

- [ ] **Write tests for Gemini adapter (`src/__tests__/adapters/gemini.test.ts`)** — Test: `responseSchema` wrapping for response format. `functionDeclarations` wrapping for tools. `default` removed. `examples` removed. `$comment` removed. Type constant uppercasing option. Nullable field handling. `$ref`/`$defs` preserved (Nov 2025+ default). Schema complexity warnings. | Status: not_done

- [ ] **Write tests for MCP adapter (`src/__tests__/adapters/mcp.test.ts`)** — Test: `inputSchema` (camelCase) wrapper. `outputSchema` included when provided. Full JSON Schema preservation (all keywords kept). Minimal transformations applied. All constraint types preserved. | Status: not_done

- [ ] **Write tests for Cohere adapter (`src/__tests__/adapters/cohere.test.ts`)** — Test: tool definition format (`{ type: "function", function: { name, description, parameters } }`). `$ref` inlining for compatibility. `$comment` removed. Standard JSON Schema types supported. | Status: not_done

- [ ] **Write tests for Ollama adapter (`src/__tests__/adapters/ollama.test.ts`)** — Test: schema goes into `format` field directly. `$ref` inlined for compatibility. `examples` and `$comment` removed. Recursive schema truncation at `maxRecursionDepth`. Simple schemas pass through with minimal changes. | Status: not_done

---

## Phase 12: Unit Tests — High-Level API

- [ ] **Write tests for `bridge()` function (`src/__tests__/bridge.test.ts`)** — Test: bridge with each provider returns correct structure `{ schema, report }`. Report has correct `sourceFormat` and `targetProvider`. Options are merged correctly (per-call > per-provider defaults > global defaults). Unknown provider throws error. Zod input detected and converted. JSON Schema input detected and passed through. TypeBox input detected and handled. Test `bridge.openai()`, `bridge.anthropic()`, etc. convenience methods return same result as `bridge(schema, 'openai')`. Test `bridge.jsonSchema()` returns standard JSON Schema without provider transforms. | Status: not_done

- [ ] **Write tests for `bridgeTool()` function (`src/__tests__/bridge-tool.test.ts`)** — Test: tool name validation (valid names pass, invalid characters throw `TypeError`). Each provider produces correct tool envelope structure. OpenAI: `{ type: "function", function: { name, description, parameters, strict } }`. Anthropic: `{ name, description, input_schema }`. Gemini: `{ name, description, parameters }`. MCP: `{ name, description, inputSchema }` + optional `outputSchema`. Cohere: `{ type: "function", function: { name, description, parameters } }`. Output schema included for MCP, omitted with info note for others. | Status: not_done

- [ ] **Write tests for `bridgeTools()` function (`src/__tests__/bridge-tool.test.ts`)** — Test: batch conversion returns array of tools and array of reports. Gemini wraps all tools in single `{ functionDeclarations: [...] }`. Empty array input returns empty results. Multiple tools each get independent transformation reports. | Status: not_done

- [ ] **Write tests for caching (`src/__tests__/cache.test.ts`)** — Test: same schema + provider + options returns cached result (reference equality for the returned object). Different schema returns different result. Different provider returns different result. Different options returns different result. `cache: false` option bypasses cache. `clearCache()` invalidates all entries. WeakMap-based caching for Zod schemas (schema garbage collected -> cache entry evicted). LRU eviction for JSON Schema cache at 1000 entries. | Status: not_done

- [ ] **Write tests for report generation (`src/__tests__/report.test.ts`)** — Test: report builder accumulates transformations in order. Warnings generated for all lossy transformations. `hasLossyTransformations` is `true` when any lossy transform exists, `false` otherwise. Summary counts match transformation list (`totalTransformations`, `losslessCount`, `lossyCount`, `keywordsRemoved`, `refsInlined`, `fieldsMadeNullable`). Validation results included in report. | Status: not_done

- [ ] **Write tests for provider validation (`src/__tests__/validate.test.ts`)** — Test: OpenAI validation catches >100 properties, >5 nesting depth, >500 enum values, >15000 enum/const character count, missing `additionalProperties: false`, property not in `required`, non-object root type. Gemini validation warns on complexity. General validation catches non-object schema and missing root type. `validate: false` skips all checks. | Status: not_done

- [ ] **Write tests for `configure()` function** — Test: global defaults applied when no per-call options. Per-provider defaults override global. Per-call options override per-provider. `resetConfig()` restores defaults. Multiple `configure()` calls merge correctly. | Status: not_done

---

## Phase 13: Snapshot Tests

- [ ] **Create canonical test schemas for snapshots** — Define a set of canonical schemas to use across all snapshot tests: (1) simple flat object (all required), (2) object with optional fields, (3) nested objects (3 levels), (4) schema with `$ref`/`$defs`, (5) recursive schema (self-referencing tree), (6) schema with `anyOf`/`oneOf`/`allOf`, (7) schema with constraints (`minimum`, `maximum`, `pattern`, `format`, `default`), (8) schema with `z.record()` / `additionalProperties` schema, (9) edge case: empty object, (10) edge case: single property, (11) edge case: at OpenAI limits (100 properties, 5 levels), (12) schema with enums. | Status: not_done

- [ ] **Write OpenAI snapshot tests (`src/__tests__/snapshots/openai/`)** — Golden-file snapshot tests for each canonical schema converted to OpenAI format. Capture exact JSON output. | Status: not_done

- [ ] **Write Anthropic snapshot tests (`src/__tests__/snapshots/anthropic/`)** — Golden-file snapshot tests for each canonical schema converted to Anthropic format. | Status: not_done

- [ ] **Write Gemini snapshot tests (`src/__tests__/snapshots/gemini/`)** — Golden-file snapshot tests for each canonical schema converted to Gemini format. | Status: not_done

- [ ] **Write MCP snapshot tests (`src/__tests__/snapshots/mcp/`)** — Golden-file snapshot tests for each canonical schema converted to MCP format. | Status: not_done

- [ ] **Write Cohere snapshot tests (`src/__tests__/snapshots/cohere/`)** — Golden-file snapshot tests for each canonical schema converted to Cohere format. | Status: not_done

- [ ] **Write Ollama snapshot tests (`src/__tests__/snapshots/ollama/`)** — Golden-file snapshot tests for each canonical schema converted to Ollama format. | Status: not_done

---

## Phase 14: Round-Trip & Compatibility Tests

- [ ] **Write round-trip tests** — For providers where the output can be parsed back, verify: source Zod schema -> bridge to provider -> extract schema from provider envelope -> structurally equivalent to canonical JSON Schema (modulo provider-specific additions like `additionalProperties: false`). Test for OpenAI (extract from `parameters`), Anthropic (extract from `input_schema`), MCP (extract from `inputSchema`). | Status: not_done

- [ ] **Write Zod v3/v4 compatibility tests** — Create parallel test suites that define the same logical schema in both Zod v3 and Zod v4 syntax, convert each through `bridge()`, and verify the outputs are structurally equivalent. Cover all Zod types from the spec's mapping table. Verify both paths produce the same canonical JSON Schema and the same provider-specific output. | Status: not_done

- [ ] **Write transformation report accuracy tests** — Verify that for a complex schema bridged to OpenAI, every transformation in the report matches an actual change in the output. Verify warning count matches lossy transformation count. Verify summary statistics are accurate. | Status: not_done

---

## Phase 15: Provider API Contract Tests (Integration)

- [ ] **Write OpenAI API contract test** — Gated behind `OPENAI_API_KEY` environment variable. Submit a bridged tool definition to the OpenAI API and verify it accepts the schema without a 400 error. Do not validate model output — only validate schema acceptance. | Status: not_done

- [ ] **Write Anthropic API contract test** — Gated behind `ANTHROPIC_API_KEY` environment variable. Submit a bridged tool definition to the Anthropic API and verify acceptance. | Status: not_done

- [ ] **Write Gemini API contract test** — Gated behind `GEMINI_API_KEY` environment variable. Submit a bridged function declaration to the Gemini API and verify acceptance. | Status: not_done

---

## Phase 16: Edge Cases & Error Handling

- [ ] **Handle empty object schemas** — Ensure `{}` and `{ type: "object" }` with no properties are handled correctly by all transforms and adapters. OpenAI strict mode should produce `{ type: "object", properties: {}, required: [], additionalProperties: false }`. | Status: not_done

- [ ] **Handle single-property objects** — Ensure objects with exactly one property work correctly through all transforms. | Status: not_done

- [ ] **Handle deeply nested schemas at provider limits** — Test schemas at exactly 5 levels of nesting for OpenAI (should pass validation) and 6 levels (should fail validation). Test schemas with exactly 100 properties (pass) and 101 (fail). | Status: not_done

- [ ] **Handle schemas with no `type` property** — Some JSON schemas use composition keywords (`anyOf`, `oneOf`) at the root without a `type` property. Ensure detection works and transforms handle this case. | Status: not_done

- [ ] **Handle invalid tool names in `bridgeTool`** — Verify that tool names with spaces, special characters, or empty strings throw `TypeError` synchronously. Verify valid names (alphanumeric + underscores) are accepted. | Status: not_done

- [ ] **Handle missing peer dependencies gracefully** — When `zod-to-json-schema` is not installed and a Zod v3 schema is passed, throw a clear error message explaining which package to install. When `zod` is not installed and a Zod schema detection is attempted, handle gracefully. | Status: not_done

- [ ] **Handle `additionalProperties` set to a schema object** — When `additionalProperties: { type: "string" }` (map-like object) is encountered for OpenAI, replace with `false` and record as `LOSSY_ADDITIONAL_PROPERTIES`. Verify the warning message explains the semantic change. | Status: not_done

- [ ] **Handle non-representable Zod types** — Test behavior for `z.transform()`, `z.refine()`, `z.pipe()`, `z.brand()`, `z.catch()`, `z.lazy()`, `z.promise()`, `z.function()`, `z.void()`, `z.undefined()`, `z.never()`. Verify that runtime-only types (transform, refine, pipe) use the base/input type. Verify that unrepresentable types (function, void, undefined, never) are handled according to the `unrepresentable` option. | Status: not_done

---

## Phase 17: Performance

- [ ] **Verify transformation speed benchmarks** — Write performance tests that measure transformation time for schemas of varying complexity. Simple schema (5-10 properties): < 0.1ms. Medium (20-30 properties, 2-3 levels): < 0.5ms. Complex (50+ properties, 4-5 levels, `$ref`): < 2ms. At OpenAI limit (100 properties, 5 levels): < 5ms. These are soft targets, not hard pass/fail, but should be monitored. | Status: not_done

- [ ] **Verify cache hit performance** — Measure that cache hits return in < 0.01ms. Verify that the cache avoids re-running the full transform pipeline on repeated calls with the same schema/provider/options. | Status: not_done

- [ ] **Verify immutability** — Test that `bridge()` does not mutate the input schema. The input object should be identical before and after the call. All transformations should produce new objects. | Status: not_done

---

## Phase 18: Documentation

- [ ] **Write README.md** — Create a comprehensive README covering: package description, installation instructions (including peer dependencies), quick-start examples for `bridge()`, `bridgeTool()`, `bridgeTools()`, per-provider convenience methods, `bridge.jsonSchema()`, `configure()`, `BridgeOptions` reference, provider support matrix, transformation report usage, Zod v3/v4 support, TypeBox support, JSON Schema support, common use cases (multi-provider deployment, provider migration audit, MCP server compatibility). | Status: not_done

- [ ] **Add JSDoc comments to all public API functions** — Ensure `bridge`, `bridgeTool`, `bridgeTools`, `configure`, `bridge.jsonSchema`, and all convenience methods have complete JSDoc with `@param`, `@returns`, `@throws`, and `@example` tags. | Status: not_done

---

## Phase 19: Build & Publish Preparation

- [ ] **Verify `npm run build` succeeds** — Ensure TypeScript compiles without errors to the `dist/` directory with declaration files (`.d.ts`) and source maps. | Status: not_done

- [ ] **Verify `npm run test` passes** — All tests pass. No skipped tests without justification. | Status: not_done

- [ ] **Verify `npm run lint` passes** — No lint errors or warnings. | Status: not_done

- [ ] **Verify package.json metadata** — Ensure `name`, `version`, `description`, `main`, `types`, `files`, `keywords`, `license`, `engines`, `peerDependencies`, `peerDependenciesMeta` (marking zod and zod-to-json-schema as optional) are all correctly set. Add relevant keywords: `schema`, `bridge`, `openai`, `anthropic`, `gemini`, `mcp`, `cohere`, `ollama`, `json-schema`, `zod`, `structured-output`, `tool-use`, `llm`. | Status: not_done

- [ ] **Bump version for initial release** — Set version to `1.0.0` (or `0.1.0` if releasing as beta). Follow monorepo versioning convention. | Status: not_done

- [ ] **Dry-run `npm publish`** — Run `npm publish --dry-run` to verify the package contents, file list, and size are correct. Ensure only `dist/` is included (per `files` field in package.json). | Status: not_done
