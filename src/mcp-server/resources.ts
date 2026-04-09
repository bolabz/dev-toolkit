/**
 * Gmail Toolkit — MCP Resources
 *
 * Static resources exposing label and profile data.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GmailContext } from '../composed/context.js';
import { getLabels, getAccount } from '../composed/index.js';

/**
 * Register all MCP resources.
 * @param server - The MCP server instance
 * @param context - The authenticated Gmail context
 */
export function registerResources(server: McpServer, context: GmailContext): void {
  const { client, labelCache } = context;

  server.registerResource(
    'labels',
    'gmail://labels',
    {
      description:
        'All Gmail labels with IDs, names, types, and counts. Use to resolve label names and understand organizational structure.',
    },
    async () => {
      const result = await getLabels(client, labelCache);
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
      const account = await getAccount(client);
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
