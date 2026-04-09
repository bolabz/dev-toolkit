#!/usr/bin/env node

/**
 * Gmail Toolkit — MCP Server (Layer 3)
 *
 * Configuration-driven tool/resource/prompt registry.
 * Thin orchestrator: auth → init → register → connect.
 *
 * Entry point: npx gmail-toolkit --mcp
 * Transport: stdio (for Claude Desktop / any MCP host)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ensureAuthenticated } from './auth.js';
import { logger } from './logger.js';
import { GmailClient } from './client/index.js';
import { LabelCache } from './composed/index.js';
import { resolveToolRegistry } from './mcp-server/tool-registry.js';

import { registerMessageTools } from './mcp-server/tools-messages.js';
import { registerThreadTools } from './mcp-server/tools-threads.js';
import { registerLabelTools } from './mcp-server/tools-labels.js';
import { registerDraftTools } from './mcp-server/tools-drafts.js';
import { registerFilterTools } from './mcp-server/tools-filters.js';
import { registerAccountTools } from './mcp-server/tools-account.js';
import { registerResources } from './mcp-server/resources.js';
import { registerPrompts } from './mcp-server/prompts.js';

const log = logger.child('mcp');

const server = new McpServer({
  name: 'gmail-toolkit',
  version: '0.1.0',
});

const toolRegistry = resolveToolRegistry();

// ---------------------------------------------------------------------------
// Server Startup
// ---------------------------------------------------------------------------

async function startServer() {
  // Resolve credential paths from env vars or defaults
  const credentialsPath = process.env.GMAIL_CREDENTIALS_PATH ?? './credentials.json';
  const tokenPath = process.env.GMAIL_TOKEN_PATH ?? './token.json';

  // Seamless auth — handles all states (no token, expired, revoked)
  const auth = await ensureAuthenticated(credentialsPath, tokenPath);

  // Initialize Layer 1 client and Layer 2 cache
  const client = new GmailClient(auth);
  const labelCache = new LabelCache(client);

  // Register all MCP capabilities
  registerMessageTools(server, toolRegistry, client, labelCache);
  registerThreadTools(server, toolRegistry, client, labelCache);
  registerLabelTools(server, toolRegistry, client, labelCache);
  registerDraftTools(server, toolRegistry, client, labelCache);
  registerFilterTools(server, toolRegistry, client, labelCache);
  registerAccountTools(server, toolRegistry, client);
  registerResources(server, client, labelCache);
  registerPrompts(server);

  // Log enabled tools
  const enabledTools = Object.entries(toolRegistry)
    .filter(([, config]) => config.enabled)
    .map(([name]) => name);
  log.info(`Starting MCP server with ${enabledTools.length} tools enabled`);

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

startServer().catch((err: unknown) => {
  log.error('Failed to start:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
