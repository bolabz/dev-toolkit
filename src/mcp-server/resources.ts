/**
 * Gmail Toolkit — MCP Resources
 *
 * Static resources exposing label and profile data.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ComposedClient } from './base.js';

/**
 * Register all MCP resources.
 * @param server - The MCP server instance
 * @param composed - The composed Layer 2 client
 */
export function registerResources(server: McpServer, composed: ComposedClient): void {
  server.registerResource(
    'labels',
    'gmail://labels',
    {
      description:
        'All Gmail labels with IDs, names, types, and counts. Use to resolve label names and understand organizational structure.',
    },
    async () => {
      const result = await composed.getLabels();
      return {
        contents: [
          {
            uri: 'gmail://labels',
            mimeType: 'application/json',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'profile',
    'gmail://profile',
    { description: 'Account email, total message/thread counts, history ID.' },
    async () => {
      const account = await composed.getAccountContext();
      return {
        contents: [
          {
            uri: 'gmail://profile',
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                email: account.email,
                messages_total: account.messages_total,
                threads_total: account.threads_total,
                history_id: account.history_id,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
