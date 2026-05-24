# AGENTS.md

## Architecture

Four-layer Gmail structure under [`src/gmail/`](src/gmail/) is enforced by [`dependency-cruiser`](.dependency-cruiser.cjs):

| Layer                            | Role                                                       |
| -------------------------------- | ---------------------------------------------------------- |
| L0 — [Infra](src/gmail/infra/)   | Auth, errors, logger, Zod schemas, shared types            |
| L1 — [Client](src/gmail/client/) | 1:1 Gmail SDK facade with retries, rate limiting, batching |
| L2 — [API](src/gmail/api/)       | Aggregated operations, body processing, caching            |
| L3 — [MCP](src/gmail/mcp/)       | MCP tools, resources, prompts for LLM use                  |

Imports only flow downward (L3→L2→L1), while any layer can use L0. Inside L2, only [`src/gmail/api/context.ts`](src/gmail/api/context.ts) may import from L1; other API files must consume L1 via `GmailContext`. Cross-layer access must go through barrel files (for example [`src/gmail/api/index.ts`](src/gmail/api/index.ts)), not deep imports.

## Conventions

- Use `import type` for all type-only imports (enforced in [`eslint.config.js`](eslint.config.js)).
- Public exports require JSDoc with `@param` descriptions and `@returns`; use TSDoc release tags for API stability.
- Do not use `console.*`; route logging through [`src/gmail/infra/logger.ts`](src/gmail/infra/logger.ts) (only this file may use `console.error`).
- Keep files under 500 non-comment, non-blank lines; strict booleans and always-curly are enforced.
- Prefix intentionally unused variables with `_` to satisfy lint rules.

## Workflow

| Task                                          | Command                    |
| --------------------------------------------- | -------------------------- |
| Live MCP dev server                           | `npm run dev`              |
| One-time OAuth token bootstrap                | `npm run setup-auth`       |
| Full local quality gate + unit tests          | `npm run test`             |
| Integration tests (live Gmail creds required) | `npm run test:integration` |
| Dependency boundary validation                | `npm run deps:check`       |
| CI-equivalent pipeline                        | `npm run ci`               |

`npm run check` executes (verify-only): typecheck → format/lint check → docs check → link check → deps check → knip check.

Git hooks in [`lefthook.yml`](lefthook.yml): pre-commit auto-fixes (knip/ESLint/Prettier), runs the full verify suite (types, boundaries, doc-links, typedoc), and regenerates the architecture diagram on `src` changes; pre-push runs `npm run ci`, commit-msg enforces Conventional Commits.

## Commits

Commit format from [`commitlint.config.js`](commitlint.config.js): required scope (kebab-case) + required body explaining **why**.

```text
feat(mcp): add thread search tool

Needed for inbox summary prompts to inspect labeled conversations.
```

## Tests and Entry Points

- [Unit tests](tests/unit/gmail/) mirror the Gmail source layout in [`src/gmail/`](src/gmail/).
- [Integration tests](tests/integration/gmail/) require valid OAuth credentials/token.
- Coverage and test config live in [`vitest.config.ts`](vitest.config.ts) and [`vitest.integration.config.ts`](vitest.integration.config.ts).
- Public package barrel is [`src/index.ts`](src/index.ts), which re-exports module barrels like [`src/gmail/index.ts`](src/gmail/index.ts).
- MCP runtime entry/binary target is [`src/gmail/mcp/server.ts`](src/gmail/mcp/server.ts) (`gmail-mcp` in [`package.json`](package.json)).
- Tool gating is implemented in [`src/gmail/mcp/tool-registry.ts`](src/gmail/mcp/tool-registry.ts) via `GMAIL_ENABLE_TOOLS` / `GMAIL_DISABLE_TOOLS`.

## New Module Pattern

Replicate the Gmail shape under [`src/`](src/) with `infra/`, `client/`, `api/`, and `mcp/` plus barrel `index.ts` files per layer. Add matching boundaries in [`.dependency-cruiser.cjs`](.dependency-cruiser.cjs), then re-export from [`src/index.ts`](src/index.ts) as a namespace (`export * as <module>`).
