/**
 * Gmail Toolkit — MCP Account Tools
 *
 * Account overview tool.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GmailClient } from '../client/index.js';
import { getAccount } from '../composed/index.js';
import type { ToolName, ToolConfig } from '../config/tools.js';
import { toMcpError } from './utils.js';

/**
 * Register account-related MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param client - The authenticated Gmail API client
 */
export function registerAccountTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  client: GmailClient,
): void {
  if (toolRegistry.gmail_get_account.enabled) {
    server.registerTool(
      'gmail_get_account',
      { description: toolRegistry.gmail_get_account.description },
      async () => {
        try {
          const result = await getAccount(client);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return toMcpError(err, 'gmail_get_account');
        }
      },
    );
  }
}
