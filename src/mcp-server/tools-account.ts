/**
 * Gmail Toolkit — MCP Account Tools
 *
 * Account overview tool.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GmailContext } from '../composed/context.js';
import { getAccount } from '../composed/index.js';
import type { ToolName, ToolConfig } from './tool-registry.js';
import { toMcpError, toMcpResult } from './utils.js';

/**
 * Register account-related MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param context - The authenticated Gmail context
 */
export function registerAccountTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  context: GmailContext,
): void {
  if (toolRegistry.gmail_get_account.enabled) {
    server.registerTool(
      'gmail_get_account',
      { description: toolRegistry.gmail_get_account.description },
      async () => {
        try {
          const result = await getAccount(context.client);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_get_account');
        }
      },
    );
  }
}
