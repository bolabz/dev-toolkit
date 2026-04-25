# Gmail Toolkit

Three-layer TypeScript toolkit for Gmail management: standalone library + MCP server.

---

## Tech Stack

- [Node.Js](package.json) - Runtime (v18+), with scripts for development, testing, building, and documentation
- [TypeScript](tsconfig.json) - TypeScript compiler (strict mode, layered project references)
- [TypeDoc](typedoc.json) - API documentation generation (strict JSDoc, public API focus, output to `docs/api/`)
- [ESLint](eslint.config.js) - Code quality and style rules, including JSDoc completeness (enforced in CI)
- [Prettier](.prettierrc) - Code formatting rules (line width, semicolons, quotes)
- [Vitest](vitest.config.ts) - Testing framework (coverage via v8 provider)
- [knip](knip.json) - Unused code detection configuration (checks for unused exports, files, dependencies)
- [dependency-cruiser](.dependency-cruiser.cjs) - Enforces layered architecture with no cross-layer imports (including type-only)
- [Mermaid Diagram](docs/architecture.mermaid) - Visual architecture diagram in Mermaid format (source of truth for architecture)
- [API Extractor](docs/gmail-toolkit.api.md) - Generated API report from API Extractor (public types/functions)
- [commitlint](commitlint.config.js) - Commit message linting rules (Conventional Commits standard)
- [lefthook](lefthook.yml) - Git hooks for pre-commit formatting/linting and pre-push testing

---

## Architecture Overview

- [**Layer 0**: Infrastructure](src/infra) — auth, logging, types/schemas, error handling
- [**Layer 1**: Client](src/client) - 1:1 Gmail API v1 facade with rate limiting, batching, pagination
- [**Layer 2**: API](src/api) - Aggregated operations with label resolution, body processing, analytics
- [**Layer 3**: MCP Server](src/mcp) - Domain-based tool modules, resources, and prompts

---

## Contributing

Frequently run these commands during development to maintain code quality and ensure a smooth contribution process:

```bash
# Development
npm run dev           # Dev mode MCP server (tsx, no build needed)
npm run check         # Auto-fix and check all code quality (formatting, lint, types)

# Testing
npm run test           # Run test suite (vitest)

# Documentation
npm run docs          # Generate documentation (TypeDoc, Mermaid architecture diagram, API report)

# Build & Check
npm run ci            # Full CI pipeline: build + API check + tests
```

---

## PR Checklist

- [ ] No unused code is added (exports, files, dependencies)
- [ ] No cross-layer imports are introduced (enforced by dependency-cruiser)
- [ ] Changes are well-documented with clear descriptions and JSDoc comments
- [ ] Code adheres to established style and formatting rules (`npm run check`)
- [ ] All new and existing tests pass successfully (`npm run test`)
- [ ] Passes all checks via `npm run ci` (build, API report, tests)
- [ ] Atomic commit messages following Conventional Commits format (e.g., `feat(api): add searchMessages with label resolution`)

---
