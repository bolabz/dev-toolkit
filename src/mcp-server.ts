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

import { logger } from './logger.js';
import { createGmailContext, type GmailContext } from './composed/index.js';
import { resolveToolRegistry, type ToolName, type ToolConfig } from './mcp-server/tool-registry.js';

import { registerMessageTools } from './mcp-server/tools-messages.js';
import { registerThreadTools } from './mcp-server/tools-threads.js';
import { registerLabelTools } from './mcp-server/tools-labels.js';
import { registerDraftTools } from './mcp-server/tools-drafts.js';
import { registerFilterTools } from './mcp-server/tools-filters.js';
import { registerAccountTools } from './mcp-server/tools-account.js';
import { registerResources } from './mcp-server/resources.js';
import { registerPrompts } from './mcp-server/prompts.js';

/** Signature shared by all domain-level tool registration functions. */
type ToolRegistrar = (
  server: McpServer,
  registry: Record<ToolName, ToolConfig>,
  context: GmailContext,
) => void;

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
  // Initialize authenticated context via Layer 2
  const credentialsPath = process.env.GMAIL_CREDENTIALS_PATH ?? './credentials.json';
  const tokenPath = process.env.GMAIL_TOKEN_PATH ?? './token.json';
  const context = await createGmailContext(credentialsPath, tokenPath);

  // Register all MCP tool capabilities (domain-based, uniform signature)
  const toolRegistrars: ToolRegistrar[] = [
    registerMessageTools,
    registerThreadTools,
    registerLabelTools,
    registerDraftTools,
    registerFilterTools,
    registerAccountTools,
  ];
  for (const register of toolRegistrars) {
    register(server, toolRegistry, context);
  }
  registerResources(server, context);
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
