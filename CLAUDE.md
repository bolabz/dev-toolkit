# Gmail Toolkit

Three-layer TypeScript toolkit for Gmail management: standalone library + MCP server.

## Commands

`@package.json` scripts for development, testing, building, and documentation generation:

```bash
# Development
npm run dev           # Dev mode MCP server (tsx, no build needed)
npm run start         # Production MCP server (built, node)
npm run fix           # Auto-fix formatting and lint issues
npm run check         # Check all code quality (formatting, lint, types)
# Testing
npm run test           # Run test suite (vitest)
npm run test:watch     # Run tests in watch mode
# Build & Check
npm run build         # Compile TypeScript and generate API report
npm run ci            # Full CI pipeline: build + API check + tests
# Documentation
npm run docs          # Generate API documentation (TypeDoc)
```

## Architecture

- **Layer 1** (`@src/client/`): 1:1 Gmail API v1 wrapper with rate limiting, batching, pagination
- **Layer 2** (`@src/composed/`): Aggregated operations with label resolution, body processing, analytics
- **Layer 3** (`@src/mcp-server.ts` + `@src/mcp-server/`): MCP server with domain-based tool modules, resources, and prompts (20 tools: 15 enabled, 5 destructive/disabled)
- **Auth** (`src/auth.ts`): Seamless OAuth2 — auto-refreshes tokens, opens browser on first use
- **Logger** (`src/logger.ts`): Singleton logger — all output to stderr, env-var controlled (`GMAIL_LOG_LEVEL`)
- **Types** (`src/types.ts`): Zod schemas serving as TypeScript types + runtime validation + MCP schemas
- `@src/index.ts` — Library entry point (`GmailToolkit` class)

## Documentation

- `@docs/architecture.mermaid` — Visual architecture diagram (Mermaid source)
- `@docs/gmail-toolkit.api.md` — Generated API report (public types and functions) from API Extractor

## Testing

45 test stubs (`it.todo()`) + 18 passing logger tests. Test infrastructure (vitest) is configured and working. Coverage via `npm run test:coverage` (v8 provider).
