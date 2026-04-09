# AGENTS.md

## Project Snapshot

- Gmail Toolkit is a **three-layer TypeScript system**: Layer 1 API wrappers (`src/client/`), Layer 2 composed operations (`src/composed/`), Layer 3 MCP exposure (`src/mcp-server.ts`).
- Library entry point is `GmailToolkit` in `src/index.ts`; MCP entry point is `src/mcp-server.ts`.
- Architecture source of truth is `docs/Gmail_Toolkit_Project_Spec.md`.

## How Data Flows (Most Important)

- Typical read path: `search()` in `src/composed/search.ts` does `messages.list -> messages.batchGet -> labelCache.resolve -> analytics summary`.
- `LabelCache` in `src/composed/labels.ts` is central across composed operations; invalidate it after label mutations (`createLabel`, `updateLabel`, delete paths).
- Layer 1 clients share one `PQueue` limiter via `GmailClient` (`src/client/index.ts`) with config in `src/client/base.ts`.
- MCP layer is intentionally thin: `server.tool(...)` handlers mostly map Zod inputs to Layer 2 calls and JSON-stringify outputs.

## High-Value Workflows

- Dev server: `npm run dev` (runs `src/mcp-server.ts` via `tsx`, no build).
- Full quality gate: `npm run test` (typecheck + format check + docs check + unit tests).
- Fast local checks before commit: `npm run typecheck` and `npm run test:unit`.
- Production build/start: `npm run build` then `npm run start`.

## Codebase-Specific Conventions

- Keep stdout clean for MCP protocol: use `logger` from `src/logger.ts` (stderr-only). Do not add `console.log`.
- Preserve the layer boundary: put Gmail API call mechanics in `src/client/*`, orchestration/aggregation in `src/composed/*`, transport wiring in `src/mcp-server.ts`.
- `src/types.ts` uses Zod schemas as canonical contracts (types + runtime validation shape); keep response field naming consistent (snake_case in public outputs).
- MCP tool enablement is config-driven via `DEFAULT_TOOL_REGISTRY` in `src/config/tools.ts` plus env overrides (`GMAIL_ENABLE_TOOLS`, `GMAIL_DISABLE_TOOLS`).
- Destructive tools (`gmail_send_*`, `gmail_trash_*`, `gmail_delete_draft`) are disabled by default; keep this safety posture unless explicitly requested.

## Integration & Auth Details

- External APIs/libs: Gmail API (`googleapis`), OAuth client (`google-auth-library`), MCP SDK (`@modelcontextprotocol/sdk`), queueing (`p-queue`).
- Auth bootstrap is in `src/auth.ts`: `ensureAuthenticated()` auto-refreshes token or opens browser OAuth flow.
- Default credential files are `./credentials.json` and `./token.json`; MCP can override via `GMAIL_CREDENTIALS_PATH` and `GMAIL_TOKEN_PATH`.

## Editing Guidance for Agents

- When adding a capability end-to-end, update in this order:
  1. Layer 1 method in `src/client/*.ts` (raw Gmail endpoint call).
  2. Layer 2 composer in `src/composed/*.ts` (business shape + label/body helpers).
  3. Public exposure (`src/index.ts` and/or `src/mcp-server.ts`).
  4. Tool registry metadata in `src/config/tools.ts` if MCP-facing.
  5. Shared schemas/types in `src/types.ts` if output contract changes.
- Maintain JSDoc completeness: ESLint + TypeDoc are strict and can fail CI (`eslint.config.js`, `typedoc.json`).
- Git hooks are active (`lefthook.yml`): pre-commit formats/lints staged files; pre-push runs typecheck, docs check, and unit tests.

## Current Testing Reality

- `tests/logger.test.ts` has substantive assertions; many other suites are currently `it.todo(...)` scaffolds.
- For behavior changes in composed/client layers, add concrete tests near the touched module (do not rely on TODO placeholders).
