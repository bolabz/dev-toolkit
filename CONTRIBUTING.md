# Contributing

Working conventions for this repository: setup, daily commands, code and commit
standards, testing, and how to extend the toolkit. These are the rules CI
enforces — where a tool owns a rule, the linked config is the source of truth
and this document explains how to satisfy it.

For _how the codebase is structured and why_, see
[ARCHITECTURE.md](ARCHITECTURE.md). All participation is expected to follow our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- **Node.js 20+** (`engines.node` in [`package.json`](package.json)).
- **Google OAuth credentials** for the Gmail API (Desktop OAuth client). Save
  as `./credentials.json`, or point `GMAIL_CREDENTIALS_PATH` at the file. The
  Google Cloud Console steps are in the [README](README.md#prerequisites).

## Setup

```bash
npm install            # installs deps + git hooks (lefthook)
npm run setup-auth     # one-time interactive OAuth; writes token.json (0600)
npm run dev            # tsx-driven MCP server with live reload
```

[`.env.example`](.env.example) lists every supported variable (credential/token
paths, OAuth callback port, log level, tool gating) — all optional with sensible
defaults.

## Daily workflow

The commands you'll actually use day to day (the full list lives in the
`scripts` block of [`package.json`](package.json)):

| Task                           | Command                    |
| ------------------------------ | -------------------------- |
| Live MCP dev server            | `npm run dev`              |
| Quality gate + unit tests      | `npm run test`             |
| Integration tests (live creds) | `npm run test:integration` |
| Dependency-boundary check      | `npm run deps:check`       |
| Full CI-equivalent pipeline    | `npm run ci`               |

`npm run check` chains (verify-only): typecheck → format/lint check → docs check
→ link check → deps check → knip check. Fixing happens earlier and automatically
— the pre-commit hook fixes staged work; run `npm run fix` for the whole repo.

## Code conventions

Enforced by [`eslint.config.js`](eslint.config.js) and
[`tsconfig.json`](tsconfig.json); run `npm run lint:fix` to auto-apply what's
fixable. The intent behind the rules:

- **`import type` for all type-only imports** — keeps the runtime import graph
  honest (and `dependency-cruiser` accurate).
- **Public exports need JSDoc** (`@param` + `@returns`) with TSDoc release tags
  (`@public` / `@beta` / `@alpha`) — these drive the API report and typedoc.
- **No `console.*`** — route logging through
  [`infra/logger.ts`](src/gmail/infra/logger.ts) (the one file permitted
  `console.error`).
- **Files stay small** — the `max-lines` rule counts non-blank, non-comment
  lines; split a module before it sprawls.
- **Strict booleans, always-curly, no unused vars** — prefix intentionally
  unused identifiers with `_`.

## Contribution standards

Beyond the mechanical rules above, every change is held to a basic bar of
integrity:

- **Stand behind your work** — be able to explain the reasoning behind any
  change; don't submit code you can't account for.
- **Represent work accurately** — take credit only for what you did, and
  attribute borrowed or generated material rather than presenting it as
  original.
- **Don't fabricate** — never invent citations, benchmarks, or test results, and
  don't present unverified claims as fact; be transparent about uncertainty.
- **Stay in scope** — keep changes within the agreed scope of the task, and
  disclose incidental changes rather than bundling them in silently.

## Commit conventions

Enforced by [`commitlint.config.js`](commitlint.config.js) via the `commit-msg`
hook. Conventional Commits with a **required kebab-case scope** and a
**required body explaining _why_**:

```bash
git commit -m "feat(mcp): add thread search tool" \
           -m "Needed for inbox summary prompts to inspect labeled conversations."
```

Two `-m` flags guarantee the required blank line between subject and body. Valid
types: `feat fix docs style refactor perf test build ci chore revert`.

## Git hooks

[`lefthook.yml`](lefthook.yml) wires three gates:

- **pre-commit** — auto-fix (`knip --fix`, `eslint --fix`, Prettier), the full
  verify suite (deps-boundary, doc-links, typecheck, typedoc), then (on `src/`
  changes) architecture-diagram regen + stage; fixers re-stage, checks are
  fail-fast, and the diagram regenerates only if everything passed.
- **pre-push** — `npm run ci` (the full pipeline).
- **commit-msg** — commitlint.

Don't bypass hooks with `--no-verify`; if one fails, fix the underlying cause.

## Testing

- **Unit tests** ([`tests/unit/`](tests/unit/)) mirror the `src/` layout;
  config in [`vitest.config.ts`](vitest.config.ts).
- **Integration tests** ([`tests/integration/`](tests/integration/)) hit the
  real Gmail API and require valid OAuth credentials; config in
  [`vitest.integration.config.ts`](vitest.integration.config.ts). Set
  `SAVE_FIXTURES=1` to write response fixtures.
- Coverage thresholds live in the unit config and rise as coverage grows.

## Adding a new module

Replicate the Gmail shape (the structural contract is in
[ARCHITECTURE.md](ARCHITECTURE.md#adding-a-module-anatomy)):

1. Create `src/<module>/` with `infra/`, `client/`, `api/`, `mcp/` — each with a
   barrel `index.ts`.
2. Keep imports downward-only; route every L2 → L1 call through a single
   [`api/context.ts`](src/gmail/api/context.ts).
3. Add matching layer-boundary rules in
   [`.dependency-cruiser.cjs`](.dependency-cruiser.cjs).
4. Re-export the module namespace from [`src/index.ts`](src/index.ts)
   (`export * as <module>`).
5. Mirror the source layout under `tests/unit/`.
6. Run `npm run deps:check` to confirm the boundaries hold.

## Definition of done

A change is done when `npm run ci` passes. It runs `audit` (npm audit,
moderate+), `docs:fresh` and `api:fresh` (fail if the generated diagram or API
report drift from the code), `check`, unit tests, and `build`. If you changed
the public API or the import graph, regenerate the derived docs first:

```bash
npm run docs           # typedoc + API report + architecture diagram
```

## Documentation maintenance

Generated artifacts under `docs/` are never hand-edited:

- `npm run docs:update` — typedoc HTML.
- `npm run api:update` — API Extractor report ([`dev-toolkit.api.md`](docs/dev-toolkit.api.md)).
- `npm run deps:diagram:update` — architecture `.mermaid` + `.svg`.

`npm run docs:fresh` and `npm run api:fresh` (both part of CI) regenerate the
diagram and the API report and fail if either differs from what's committed —
keeping both pinned to the code.

`npm run docs:links` validates that every relative link and cross-file heading
anchor in the Markdown docs resolves (via `remark-validate-links`, configured in
[`.remarkrc.json`](.remarkrc.json)); it runs offline as part of `npm run check`.
External URL liveness is intentionally out of scope, to keep the gate
deterministic.
