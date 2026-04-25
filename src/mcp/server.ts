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
import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  logger,
  createGmailToolkit,
  type GmailToolkit,
  resolveToolRegistry,
  type ToolName,
  type ToolConfig,
  beginAuthFlow,
  MissingCredentialsError,
  AuthenticationRequiredError,
} from './base.js';

import { registerReadTools } from './tools-read.js';
import { registerCreateTools } from './tools-create.js';
import { registerUpdateTools } from './tools-update.js';
import { registerDeleteTools } from './tools-delete.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

/** Signature infra by all domain-level tool registration functions. */
type ToolRegistrar = (
  server: McpServer,
  registry: Record<ToolName, ToolConfig>,
  composed: GmailToolkit,
) => void;

const log = logger.child('mcp');

const toolRegistrars: ToolRegistrar[] = [
  registerReadTools,
  registerCreateTools,
  registerUpdateTools,
  registerDeleteTools,
];

// ---------------------------------------------------------------------------
// MCP Server Factory — transport-agnostic, testable
// ---------------------------------------------------------------------------

/**
 * Create a fully configured McpServer with all tools, resources, and prompts
 * registered. Transport-agnostic — caller connects their own transport
 * (StdioServerTransport for production, InMemoryTransport for tests).
 * @param toolkit - The authenticated GmailToolkit providing L2 operations
 * @param registry - Optional tool registry override (defaults to env-resolved registry)
 * @returns A configured McpServer ready for transport connection
 */
export function createMcpServer(
  toolkit: GmailToolkit,
  registry?: Record<ToolName, ToolConfig>,
): McpServer {
  const reg = registry ?? resolveToolRegistry();
  const server = new McpServer({ name: 'gmail-toolkit', version: '0.1.0' });

  for (const register of toolRegistrars) {
    register(server, reg, toolkit);
  }
  registerResources(server, toolkit);
  registerPrompts(server);

  return server;
}

// ---------------------------------------------------------------------------
// Auth Flow State
// ---------------------------------------------------------------------------

let authFlowActive: Promise<void> | null = null;
const stubToolRefs: RegisteredTool[] = [];

// ---------------------------------------------------------------------------
// Server Startup
// ---------------------------------------------------------------------------

/**
 * Initialize auth, register tools, and connect the MCP transport.
 *
 * Three auth states are handled:
 *   1. Authenticated → fully configured server via createMcpServer()
 *   2. Token missing/expired (credentials exist) → OAuth stubs on bare server
 *   3. Credentials missing → static error stubs on bare server
 */
async function startServer() {
  const toolRegistry = resolveToolRegistry();
  let mcpServer: McpServer;

  // Attempt authentication — capture error for branching, do not crash
  let toolkit: GmailToolkit | undefined;
  let authError: unknown;

  try {
    toolkit = await createGmailToolkit();
  } catch (err: unknown) {
    authError = err;
  }

  if (toolkit) {
    // Happy path: factory produces a fully configured server
    mcpServer = createMcpServer(toolkit, toolRegistry);
  } else {
    // Auth failed: bare server with prompts + appropriate stubs
    mcpServer = new McpServer({ name: 'gmail-toolkit', version: '0.1.0' });
    registerPrompts(mcpServer);

    if (authError instanceof AuthenticationRequiredError) {
      log.warn('No valid token. Tools will prompt for OAuth sign-in.');
      registerOAuthStubs(mcpServer, toolRegistry);
    } else if (authError instanceof MissingCredentialsError) {
      log.warn('Credentials not found. Tools will show setup instructions.');
      registerUnauthenticatedTools(mcpServer, toolRegistry, authError.message);
    } else {
      const msg = authError instanceof Error ? authError.message : String(authError);
      log.warn('Authentication failed:', msg);
      registerUnauthenticatedTools(mcpServer, toolRegistry, msg);
    }
  }

  // Log enabled tools
  const enabledTools = Object.entries(toolRegistry)
    .filter(([, config]) => config.enabled)
    .map(([name]) => name);
  log.info(`Starting MCP server with ${enabledTools.length} tools enabled`);

  // Start stdio transport
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

/**
 * Register OAuth-aware stub tools that start a browser auth flow on first invocation.
 *
 * When any tool is called, the stub generates an OAuth consent URL and starts a
 * localhost redirect listener. The URL is returned to the user. Once they authorize
 * in their browser, the token is saved and stubs are swapped for real tools via
 * createMcpServer().
 * @param server - The MCP server instance
 * @param registry - The tool configuration registry
 */
function registerOAuthStubs(server: McpServer, registry: Record<ToolName, ToolConfig>): void {
  /** URL from the most recently started auth flow, shown in tool responses. */
  let currentAuthUrl: string | undefined;

  for (const [name, config] of Object.entries(registry)) {
    if (!config.enabled) {
      continue;
    }
    const ref = server.registerTool(
      name,
      { description: config.description, inputSchema: {} },
      async () => {
        log.warn(`Tool "${name}" called without authentication`);

        // Start a new auth flow if none is active
        if (authFlowActive == null) {
          try {
            const { url, completed } = beginAuthFlow();
            currentAuthUrl = url;
            authFlowActive = completed;

            // Background: swap stubs for real tools when auth completes
            completed
              .then(async () => {
                log.info('OAuth complete — activating tools.');
                const tk = await createGmailToolkit();
                swapToRealTools(server, registry, tk);
              })
              .catch((err: unknown) => {
                authFlowActive = null;
                currentAuthUrl = undefined;
                const msg = err instanceof Error ? err.message : String(err);
                log.warn(`Auth flow ended: ${msg}`);
              });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: 'text' as const, text: `Failed to start auth flow: ${msg}` }],
              isError: true,
            };
          }
        }

        const instructions =
          currentAuthUrl !== undefined
            ? 'Gmail Toolkit needs authorization.\n\n' +
              'Visit this URL to sign in with Google:\n\n' +
              `${currentAuthUrl}\n\n` +
              'After you authorize in your browser, Gmail tools will activate automatically.\n' +
              'This link expires in 2 minutes.'
            : 'Authorization is in progress. Please complete sign-in at the link provided earlier,\n' +
              'or wait a moment and try again for a fresh link.';

        return {
          content: [{ type: 'text' as const, text: instructions }],
          isError: true,
        };
      },
    );
    stubToolRefs.push(ref);
  }
}

/**
 * Replace all OAuth stubs with fully functional tools and resources.
 * Called automatically when the user completes browser OAuth consent.
 * Re-registers tools using the same registrars as createMcpServer().
 * @param server - The MCP server to update in-place
 * @param registry - The tool configuration registry
 * @param toolkit - The newly authenticated GmailToolkit instance
 */
function swapToRealTools(
  server: McpServer,
  registry: Record<ToolName, ToolConfig>,
  toolkit: GmailToolkit,
): void {
  for (const stub of stubToolRefs) {
    stub.remove();
  }
  stubToolRefs.length = 0;
  authFlowActive = null;

  for (const register of toolRegistrars) {
    register(server, registry, toolkit);
  }
  registerResources(server, toolkit);

  server.sendToolListChanged();
  server.sendResourceListChanged();
  log.info('Tools activated. Gmail Toolkit is ready.');
}

// ---------------------------------------------------------------------------
// Static Unauthenticated Stubs (missing credentials.json)
// ---------------------------------------------------------------------------

/**
 * Register stub handlers that show setup instructions when credentials.json is missing.
 * @param server - The MCP server instance
 * @param registry - The tool configuration registry
 * @param errorMessage - The auth error message to surface
 */
function registerUnauthenticatedTools(
  server: McpServer,
  registry: Record<ToolName, ToolConfig>,
  errorMessage: string,
): void {
  const authInstructions =
    'Gmail Toolkit requires authentication.\n\n' +
    'Run the setup script in the gmail-toolkit directory:\n\n' +
    '  npm run setup-auth\n\n' +
    'Then restart this MCP server.';

  for (const [name, config] of Object.entries(registry)) {
    if (!config.enabled) {
      continue;
    }
    server.registerTool(name, { description: config.description, inputSchema: {} }, async () => {
      log.warn(`Tool "${name}" called without credentials`);
      return {
        content: [{ type: 'text' as const, text: `${authInstructions}\n\nError: ${errorMessage}` }],
        isError: true,
      };
    });
  }
}

startServer().catch((err: unknown) => {
  log.error('Failed to start:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
