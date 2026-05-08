# AGENTS.md

## Project Snapshot

- **Dev Toolkit** is a multi-module TypeScript developer toolkit for third-party SDK integrations with MCP server exposure. The first module is **Gmail**.
- Each module follows a **three-layer system**: Layer 1 API wrappers (`src/<module>/client/`), Layer 2 composed operations (`src/<module>/api/`), Layer 3 MCP server (`src/<module>/mcp/`).
- Top-level entry point is `src/index.ts` — exposes the `gmail` namespace as the primary public API and re-exports deprecated named imports for one cycle.
- Gmail module barrel is `src/gmail/index.ts` — re-exports `createGmailToolkit` from `src/gmail/api/index.ts`. MCP entry point for Gmail is `src/gmail/mcp/server.ts` (binary `gmail-mcp`).
- Architecture source of truth is `docs/Gmail_Toolkit_Project_Spec.md` (will be generalized as additional modules join).
- Cross-cutting infrastructure (`auth.ts`, `errors.ts`, `logger.ts`, `types.ts`) lives in `src/gmail/infra/` and is re-exported via `src/gmail/infra/index.ts` barrel. When a second module joins, genuinely shared infra will be extracted to a top-level `src/shared/`.

## How Data Flows (Most Important)

- Typical read path: `search()` in `src/gmail/api/messages.ts` does `messages.list -> messages.batchGet -> label-cache.resolve -> analytics summary`.
- `LabelCache` in `src/gmail/api/label-cache.ts` is central across composed operations; invalidate it after label mutations (`createLabel`, `updateLabel`, delete paths).
- Layer 1 clients share one `PQueue` limiter via `GmailClient` (`src/gmail/client/index.ts`) with config in `src/gmail/client/base.ts`.
- MCP layer architecture: `src/gmail/mcp/base.ts` is the internal hub — all tool modules (`tools-*.ts`, `resources.ts`) and `server.ts` import from it, giving Layer 3 a single unified internal dependency (mirrors `src/gmail/api/context.ts` role for Layer 2). Domain-specific handlers in `src/gmail/mcp/tools-*.ts` map Zod inputs to Layer 2 calls and JSON-stringify outputs.
- MCP server also exposes 2 **resources** (`gmail://labels`, `gmail://profile`) in `src/gmail/mcp/resources.ts` and 5 **prompts** in `src/gmail/mcp/prompts.ts`.
- Error flow: Layer 1 wraps all API failures in `GmailApiError` (carries HTTP code + `retryable` flag); Layer 2 throws `GmailValidationError` for bad caller input; Layer 3 catches both and serialises via `toMcpResult()` in `src/gmail/mcp/utils.ts` into `GmailToolkitError` DTO.

## Layer Dependency Rules (within a module)

- **Layer 1 imports nothing from Layer 2 or 3.** It is a pure SDK wrapper.
- **Layer 2 imports from Layer 1 only.** Composed operations call client methods.
- **Layer 3 imports from Layer 2 only.** MCP tools call composed operations. Layer 3 must NOT import from `src/<module>/client/` directly.
- **Module barrel (`src/<module>/index.ts`) imports from Layer 1 and Layer 2.** It sits above all layers as the module's public API.
- **Toolkit barrel (`src/index.ts`) imports only module barrels** — never reaches into a module's internals.
- Cross-cutting modules (`auth.ts`, `errors.ts`, `logger.ts`, `types.ts`) are shared by all layers within a module.

## Codebase-Specific Conventions

- Keep stdout clean for MCP protocol: use `logger` from `src/gmail/infra/logger.ts` (stderr-only). Do not add `console.log`. The logger is the only file allowed to use `console.error` (override in `eslint.config.js`).
- Preserve the layer boundary: put Gmail API call mechanics in `src/gmail/client/*`, orchestration/aggregation in `src/gmail/api/*`, transport wiring in `src/gmail/mcp/`. Layer boundaries are enforced by dependency-cruiser (`.dependency-cruiser.cjs`). Run `npm run deps:check` to validate. The tool catches both direct and transitive violations, including type-only imports.
- `src/gmail/infra/types.ts` uses Zod schemas as canonical contracts (types + runtime validation shape); keep response field naming consistent (snake_case in public outputs).
- MCP tool enablement is config-driven via `DEFAULT_TOOL_REGISTRY` in `src/gmail/mcp/tool-registry.ts` plus env overrides (`GMAIL_ENABLE_TOOLS`, `GMAIL_DISABLE_TOOLS`). The registry has 20 tools total: 15 enabled by default (7 read + 8 write), 5 destructive disabled.
- Destructive tools (`gmail_send_*`, `gmail_trash_*`, `gmail_delete_draft`) are disabled by default; keep this safety posture unless explicitly requested. `gmail_delete_label` and `gmail_delete_filter` are in the `write` category and **are** enabled by default.
- Error classes live in `src/gmail/infra/errors.ts`: throw `GmailApiError` at Layer 1 boundaries, `GmailValidationError` at Layer 2 for bad caller input. Never throw raw errors across layer boundaries.
- Internal helpers (`parseContact`, `headerMap`, `transformMessage`, `buildRfc2822Message`, etc.) live in `src/gmail/api/helpers.ts` and are imported directly — they are NOT re-exported from the api barrel. `processBody` in `body-processing.ts` is marked `@internal` (not yet wired up).
- Barrel exports (`index.ts` files) export only the public surface of each layer. Do not re-export internal utilities through barrels.
- Authentication uses `ensureAuthenticated()` from `src/gmail/infra/auth.ts`. Do not implement custom auth flows.
- Credential files default to `./credentials.json` and `./token.json`; MCP overrides via `GMAIL_CREDENTIALS_PATH` and `GMAIL_TOKEN_PATH`.

## Editing Guidance for Agents

- When adding a capability end-to-end inside the Gmail module, update in this order:
  1. Layer 1 method in `src/gmail/client/*.ts` (raw Gmail endpoint call).
  2. Layer 2 composer in `src/gmail/api/*.ts` (business shape + label/body helpers).
  3. Public exposure: `src/gmail/index.ts` (GmailToolkit method) and/or `src/gmail/mcp/tools-*.ts` (MCP tool).
  4. Tool registry metadata in `src/gmail/mcp/tool-registry.ts` if MCP-facing.
  5. Shared schemas/types in `src/gmail/infra/types.ts` if output contract changes.
- When adding an MCP tool handler, wrap the Layer 2 call in `try/catch` and return `toMcpResult()` on failure — see any existing handler in `src/gmail/mcp/tools-*.ts` for the pattern.
- When adding a new module (e.g., `src/calendar/`), mirror the four-layer structure and add the namespace export to `src/index.ts` (`export * as calendar from './calendar/index.js'`). Update `.dependency-cruiser.cjs` with module-scoped layer rules and consider extracting genuinely-shared utilities into `src/shared/`.
- Run `npm run knip` to detect unused exports, files, and dependencies. Fix findings before committing.
- Public API changes must update the API report: run `npm run build && npm run api:update` and commit the updated `docs/dev-toolkit.api.md`.
- Maintain JSDoc completeness: ESLint + TypeDoc are strict and can fail CI (`eslint.config.js`, `typedoc.json`).
- Git hooks are active (`lefthook.yml`): pre-commit formats/lints staged files; pre-push runs full test suite (`npm run test`).

## Current Testing Reality

- `tests/unit/gmail/infra/logger.test.ts` has substantive assertions; many other suites are currently `it.todo(...)` scaffolds.
- For behavior changes in composed/client layers, add concrete tests near the touched module (do not rely on TODO placeholders).
- Live integration tests live under `tests/integration/gmail/` and use the real Gmail API; run with `npm run test:integration` (requires authenticated credentials).
