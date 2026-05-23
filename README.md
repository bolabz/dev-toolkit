# Dev Toolkit

A multi-module TypeScript developer toolkit for third-party SDK integrations with MCP (Model Context Protocol) server exposure. Each module ships as both a library namespace and an installable MCP server, so the same code powers both programmatic use and LLM-driven workflows.

**Status:** Gmail is the first module. The module structure is built so additional Google API integrations can follow the same shape.

---

## Modules

| Module | Library namespace           | MCP binary  | Description                                                                |
| ------ | --------------------------- | ----------- | -------------------------------------------------------------------------- |
| Gmail  | `import { gmail } from ...` | `gmail-mcp` | Search, read, label, draft, filter, and history with quota-aware batching. |

---

## Architecture

Each module follows the same four-layer shape:

- **L0 — Infrastructure** (`src/<module>/infra/`): auth, logging, error classes, Zod schemas
- **L1 — Client** (`src/<module>/client/`): 1:1 SDK facade with rate limiting, retries, batching, response validation
- **L2 — API** (`src/<module>/api/`): aggregated operations, caching, body processing, analytics
- **L3 — MCP** (`src/<module>/mcp/`): tool modules, resources, and prompts for LLM consumption

Layer boundaries are enforced by `dependency-cruiser` ([config](.dependency-cruiser.cjs)). The diagram below is auto-generated from the actual import graph and re-checked on every push — it cannot drift from the code. See [docs/dev-toolkit.api.md](docs/dev-toolkit.api.md) for the public API report.

<img src="docs/architecture.svg" width="800" alt="Dev Toolkit architecture (auto-generated from dependency-cruiser)">

---

## Library usage (Gmail module)

```ts
import { gmail } from 'dev-toolkit';

const toolkit = await gmail.createGmailToolkit();
const results = await toolkit.search('is:unread from:chase');
```

Auth resolves from `GMAIL_CREDENTIALS_PATH` and `GMAIL_TOKEN_PATH` env vars or `./credentials.json` / `./token.json` defaults. First-use OAuth is interactive; subsequent runs use the cached token.

## Prerequisites

- **Node.js 20+** (per `engines.node` in `package.json`).
- **Google OAuth credentials** for the Gmail API:
  1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project.
  2. Enable the **Gmail API**.
  3. Create an **OAuth 2.0 Client ID** (Desktop application).
  4. Download the credentials JSON and save it as `./credentials.json` at the repo root (or set `GMAIL_CREDENTIALS_PATH` to its absolute path).
- **One-time auth**: run `npm run setup-auth` to complete the interactive OAuth flow. This produces `./token.json` (or wherever `GMAIL_TOKEN_PATH` points). The MCP server cannot do interactive OAuth from inside Claude Desktop, so this step is required before configuring the MCP server.
- **Optional config**: copy [`.env.example`](.env.example) to `.env` for the full list of supported environment variables (credential/token paths, OAuth callback port, log level, tool gating) — all optional with sensible defaults.

## MCP server usage

First, build and install the `gmail-mcp` binary onto your PATH (until the package is published to npm):

```bash
npm install
npm run build
npm install -g .   # registers the gmail-mcp binary globally
```

Then add the Gmail MCP server to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "gmail-mcp",
      "env": {
        "GMAIL_CREDENTIALS_PATH": "/absolute/path/to/credentials.json",
        "GMAIL_TOKEN_PATH": "/absolute/path/to/token.json"
      }
    }
  }
}
```

If you'd rather skip the global install, swap the `command` for an absolute node invocation: `"command": "node", "args": ["/absolute/path/to/dev-toolkit/dist/gmail/mcp/server.js"]`.

The Gmail MCP server exposes 14 tools (4 read + 7 write + 3 destructive, with destructive disabled by default), 3 resources (`gmail://labels`, `gmail://filters`, `gmail://profile`), and 5 prompts. Tool enablement is configurable via `GMAIL_ENABLE_TOOLS` and `GMAIL_DISABLE_TOOLS` env vars.

---

## Development

```bash
npm install
npm run setup-auth        # one-time OAuth flow
npm run dev               # tsx-driven MCP server with live reload
npm run test              # full check + unit tests
npm run test:integration  # live Gmail API tests (requires credentials)
npm run ci                # full pipeline: check + tests + build
```

For internal architecture, layer dependency rules, and conventions, see [AGENTS.md](AGENTS.md).
