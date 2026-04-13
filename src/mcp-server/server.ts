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
  createGmailContext,
  ComposedClient,
  type GmailContext,
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

/** Signature shared by all domain-level tool registration functions. */
type ToolRegistrar = (
  server: McpServer,
  registry: Record<ToolName, ToolConfig>,
  composed: ComposedClient,
) => void;

const log = logger.child('mcp');

const mcpServer = new McpServer({
  name: 'gmail-toolkit',
  version: '0.1.0',
});

const toolRegistry = resolveToolRegistry();

const toolRegistrars: ToolRegistrar[] = [
  registerReadTools,
  registerCreateTools,
  registerUpdateTools,
  registerDeleteTools,
];

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
 *   1. Authenticated → register fully functional tools + resources
 *   2. Token missing/expired (credentials exist) → register OAuth stubs
 *   3. Credentials missing → register static error stubs
 */
async function startServer() {
  const credentialsPath = process.env.GMAIL_CREDENTIALS_PATH ?? './credentials.json';
  const tokenPath = process.env.GMAIL_TOKEN_PATH ?? './token.json';

  // Attempt authentication — do not crash if it fails
  let context: GmailContext | undefined;

  try {
    context = await createGmailContext(credentialsPath, tokenPath);
  } catch (err: unknown) {
    if (err instanceof AuthenticationRequiredError) {
      log.warn('No valid token. Tools will prompt for OAuth sign-in.');
      registerOAuthStubs(mcpServer, toolRegistry, credentialsPath, tokenPath);
    } else if (err instanceof MissingCredentialsError) {
      log.warn('Credentials not found. Tools will show setup instructions.');
      registerUnauthenticatedTools(mcpServer, toolRegistry, err.message);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('Authentication failed:', msg);
      registerUnauthenticatedTools(mcpServer, toolRegistry, msg);
    }
  }

  if (context) {
    registerAllTools(context);
  }

  // Prompts are static — register regardless of auth state
  registerPrompts(mcpServer);

  // Log enabled tools
  const enabledTools = Object.entries(toolRegistry)
    .filter(([, config]) => config.enabled)
    .map(([name]) => name);
  log.info(`Starting MCP server with ${enabledTools.length} tools enabled`);

  // Start stdio transport
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

// ---------------------------------------------------------------------------
// Tool Registration Helpers
// ---------------------------------------------------------------------------

/**
 * Register all fully functional tools and resources with an authenticated context.
 * @param context - The authenticated Gmail context
 */
function registerAllTools(context: GmailContext): void {
  const composed = new ComposedClient(context);
  for (const register of toolRegistrars) {
    register(mcpServer, toolRegistry, composed);
  }
  registerResources(mcpServer, composed);
}

/**
 * Register OAuth-aware stub tools that start a browser auth flow on first invocation.
 *
 * When any tool is called, the stub generates an OAuth consent URL and starts a
 * localhost redirect listener. The URL is returned to the user. Once they authorize
 * in their browser, the token is saved and stubs are swapped for real tools.
 * @param server - The MCP server instance
 * @param registry - The tool configuration registry
 * @param credentialsPath - Path to Google OAuth credentials.json
 * @param tokenPath - Path where the OAuth token will be stored
 */
function registerOAuthStubs(
  server: McpServer,
  registry: Record<ToolName, ToolConfig>,
  credentialsPath: string,
  tokenPath: string,
): void {
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
            const { url, completed } = beginAuthFlow(credentialsPath, tokenPath);
            currentAuthUrl = url;
            authFlowActive = completed;

            // Background: swap to real tools when auth completes
            completed
              .then(async () => {
                log.info('OAuth complete — activating tools.');
                const ctx = await createGmailContext(credentialsPath, tokenPath);
                swapToRealTools(ctx);
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
 * @param context - The newly authenticated Gmail context
 */
function swapToRealTools(context: GmailContext): void {
  for (const stub of stubToolRefs) {
    stub.remove();
  }
  stubToolRefs.length = 0;
  authFlowActive = null;

  registerAllTools(context);

  mcpServer.sendToolListChanged();
  mcpServer.sendResourceListChanged();
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
