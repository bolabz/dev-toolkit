# Gmail Toolkit

Three-layer TypeScript toolkit for Gmail management: standalone library + MCP server.

## Commands

```bash
# Development
npm run dev          # Dev mode MCP server (tsx, no build needed)
npm run start        # Production MCP server (requires build)
npm run setup-auth   # Optional pre-auth script

# Build & Check
npm run build        # Clean + compile TypeScript → dist/ (uses tsconfig.build.json)
npm run typecheck    # Type check only, no emit (uses tsconfig.json)
npm run clean        # Remove dist/, coverage/, docs/typedoc/

# Formatting & Linting
npm run prettier:check   # Check Prettier compliance
npm run prettier:write   # Auto-format with Prettier
npm run lint:check       # ESLint with zero warnings allowed
npm run lint:fix         # ESLint with auto-fix
npm run format:check     # Prettier + ESLint check (combined)
npm run format:fix       # Prettier + ESLint fix (combined)

# Testing
npm run test         # Full suite: typecheck + format:check + docs:check + test:unit
npm run test:unit    # Vitest unit tests only
npm run test:watch   # Vitest in watch mode

# Documentation
npm run docs         # Generate TypeDoc API docs → docs/typedoc/
npm run docs:check   # Validate TypeDoc without emitting

# CI
npm run ci           # Build + full test suite
```

## Architecture

- **Layer 1** (`src/client/`): 1:1 Gmail API v1 wrapper with rate limiting, batching, pagination
- **Layer 2** (`src/composed/`): Aggregated operations with label resolution, body processing, analytics
- **Layer 3** (`src/mcp-server.ts` + `src/mcp-server/`): MCP server with domain-based tool modules, resources, and prompts (20 tools: 15 enabled, 5 destructive/disabled)
- **Auth** (`src/auth.ts`): Seamless OAuth2 — auto-refreshes tokens, opens browser on first use
- **Logger** (`src/logger.ts`): Singleton logger — all output to stderr, env-var controlled (`GMAIL_LOG_LEVEL`)
- **Types** (`src/types.ts`): Zod schemas serving as TypeScript types + runtime validation + MCP schemas

## Key Files

- `docs/Gmail_Toolkit_Project_Spec.md` — Full architecture spec (source of truth)
- `docs/Gmail_API_Complete_Reference.md` — Gmail API endpoint reference
- `docs/known-gaps.md` — Tracked limitations and planned improvements
- `src/index.ts` — Library entry point (`GmailToolkit` class)
- `src/mcp-server.ts` — MCP server entry point (orchestrator)
- `src/mcp-server/tool-registry.ts` — Tool configuration and enable/disable registry
- `src/logger.ts` — Logger singleton with child loggers

## Dev Tooling

- **Prettier** (`.prettierrc`): Code formatting — single quotes, trailing commas, 100 char width
- **ESLint** (`eslint.config.js`): Flat config — strict TypeScript, JSDoc enforcement, `no-console` (logger.ts exempt), `max-lines` (400 code-lines, skipBlankLines/skipComments)
- **TypeDoc** (`typedoc.json`): API documentation generation with strict validation
- **Lefthook** (`lefthook.yml`): Git hooks — pre-commit (prettier + eslint), pre-push (typecheck + docs + tests), commit-msg (commitlint)
- **Commitlint** (`commitlint.config.js`): Conventional commit message enforcement
- **TypeScript**: Split config — `tsconfig.json` (check, noEmit) + `tsconfig.build.json` (emit, declarations)

## Auth

Requires `credentials.json` from Google Cloud Console (gitignored). On first run, opens browser for OAuth consent and saves `token.json`. See spec Section 3 for setup steps.

## Testing

45 test stubs (`it.todo()`) + 18 passing logger tests. Test infrastructure (vitest) is configured and working.

## Known Gaps

See `docs/known-gaps.md` for full details including Layer 2 coverage audit and implementation guidance.
