# AGENTS.md

## Project Snapshot

- Gmail Toolkit is a **three-layer TypeScript system**: Layer 1 API wrappers (`src/client/`), Layer 2 composed operations (`src/composed/`), Layer 3 MCP server (`src/mcp-server.ts` + `src/mcp-server/`).
- Library entry point is `GmailToolkit` in `src/index.ts`; MCP entry point is `src/mcp-server.ts`.
- Architecture source of truth is `docs/Gmail_Toolkit_Project_Spec.md`.

## How Data Flows (Most Important)

- Typical read path: `search()` in `src/composed/messages.ts` does `messages.list -> messages.batchGet -> labelCache.resolve -> analytics summary`.
- `LabelCache` in `src/composed/labels.ts` is central across composed operations; invalidate it after label mutations (`createLabel`, `updateLabel`, delete paths).
- Layer 1 clients share one `PQueue` limiter via `GmailClient` (`src/client/index.ts`) with config in `src/client/base.ts`.
- MCP layer is a thin domain-based split: `server.registerTool(...)` handlers in `src/mcp-server/tools-*.ts` map Zod inputs to Layer 2 calls and JSON-stringify outputs.
- MCP server also exposes 2 **resources** (`gmail://labels`, `gmail://profile`) in `src/mcp-server/resources.ts` and 5 **prompts** in `src/mcp-server/prompts.ts`.
- Error flow: Layer 1 wraps all API failures in `GmailApiError` (carries HTTP code + `retryable` flag); Layer 2 throws `GmailValidationError` for bad caller input; Layer 3 catches both and serialises via `toMcpError()` in `src/mcp-server/utils.ts` into `GmailToolkitError` DTO.

## Layer Dependency Rules

- **Layer 1 imports nothing from Layer 2 or 3.** It is a pure Gmail API wrapper.
- **Layer 2 imports from Layer 1 only.** Composed operations call client methods.
- **Layer 3 imports from Layer 2 only.** MCP tools call composed operations. Layer 3 must NOT import from `src/client/` directly.
- **`src/index.ts` imports from Layer 1 and Layer 2.** It sits above all layers as the public API.
- Cross-cutting modules (`auth.ts`, `errors.ts`, `logger.ts`, `types.ts`) are shared by all layers.

## Codebase-Specific Conventions

- Keep stdout clean for MCP protocol: use `logger` from `src/logger.ts` (stderr-only). Do not add `console.log`.
- Preserve the layer boundary: put Gmail API call mechanics in `src/client/*`, orchestration/aggregation in `src/composed/*`, transport wiring in `src/mcp-server/`. Layer boundaries are enforced by dependency-cruiser (`.dependency-cruiser.cjs`). Run `npm run deps:check` to validate. The tool catches both direct and transitive violations, including type-only imports.
- `src/types.ts` uses Zod schemas as canonical contracts (types + runtime validation shape); keep response field naming consistent (snake_case in public outputs).
- MCP tool enablement is config-driven via `DEFAULT_TOOL_REGISTRY` in `src/mcp-server/tool-registry.ts` plus env overrides (`GMAIL_ENABLE_TOOLS`, `GMAIL_DISABLE_TOOLS`). The registry has 20 tools total: 15 enabled by default (7 read + 8 write), 5 destructive disabled.
- Destructive tools (`gmail_send_*`, `gmail_trash_*`, `gmail_delete_draft`) are disabled by default; keep this safety posture unless explicitly requested. `gmail_delete_label` and `gmail_delete_filter` are in the `write` category and **are** enabled by default.
- Error classes live in `src/errors.ts`: throw `GmailApiError` at Layer 1 boundaries, `GmailValidationError` at Layer 2 for bad caller input. Never throw raw errors across layer boundaries.
- Internal helpers (`parseContact`, `headerMap`, `transformMessage`, `buildRfc2822Message`, etc.) live in `src/composed/helpers.ts` and are imported directly — they are NOT re-exported from the composed barrel. `processBody` in `body-processing.ts` is marked `@internal` (not yet wired up).
- Barrel exports (`index.ts` files) export only the public surface of each layer. Do not re-export internal utilities through barrels.
- Authentication uses `ensureAuthenticated()` from `src/auth.ts`. Do not implement custom auth flows.
- Credential files default to `./credentials.json` and `./token.json`; MCP overrides via `GMAIL_CREDENTIALS_PATH` and `GMAIL_TOKEN_PATH`.

## Editing Guidance for Agents

- When adding a capability end-to-end, update in this order:
  1. Layer 1 method in `src/client/*.ts` (raw Gmail endpoint call).
  2. Layer 2 composer in `src/composed/*.ts` (business shape + label/body helpers).
  3. Public exposure: `src/index.ts` (GmailToolkit method) and/or `src/mcp-server/tools-*.ts` (MCP tool).
  4. Tool registry metadata in `src/mcp-server/tool-registry.ts` if MCP-facing.
  5. Shared schemas/types in `src/types.ts` if output contract changes.
- When adding an MCP tool handler, wrap the Layer 2 call in `try/catch` and return `toMcpError(err, 'tool_name')` on failure — see any existing handler in `src/mcp-server/tools-*.ts` for the pattern.
- Maintain JSDoc completeness: ESLint + TypeDoc are strict and can fail CI (`eslint.config.js`, `typedoc.json`).
- Git hooks are active (`lefthook.yml`): pre-commit formats/lints staged files; pre-push runs typecheck, docs check, and unit tests.

## Current Testing Reality

- `tests/logger.test.ts` has substantive assertions; many other suites are currently `it.todo(...)` scaffolds.
- For behavior changes in composed/client layers, add concrete tests near the touched module (do not rely on TODO placeholders).
