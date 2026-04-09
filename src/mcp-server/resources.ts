/**
 * Gmail Toolkit — MCP Resources
 *
 * Static resources exposing label and profile data.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GmailClient } from '../client/index.js';
import type { LabelCache } from '../composed/labels.js';
import { getLabels } from '../composed/index.js';

/**
 * Register all MCP resources.
 * @param server - The MCP server instance
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 */
export function registerResources(
  server: McpServer,
  client: GmailClient,
  labelCache: LabelCache,
): void {
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
      const profile = await client.settings.getProfile();
      return {
        contents: [
          {
            uri: 'gmail://profile',
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                email: profile.emailAddress,
                messages_total: profile.messagesTotal,
                threads_total: profile.threadsTotal,
                history_id: profile.historyId,
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
