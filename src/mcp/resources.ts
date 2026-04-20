/**
 * Gmail Toolkit — MCP Resources
 *
 * Static resources exposing label and profile data.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GmailToolkit } from './base.js';

/**
 * Register all MCP resources.
 * @param server - The MCP server instance
 * @param composed - The api Layer 2 client
 */
export function registerResources(server: McpServer, composed: GmailToolkit): void {
  server.registerResource(
    'labels',
    'gmail://labels',
    {
      description: 'All Gmail labels with IDs, names, types, and counts.',
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
    'filters',
    'gmail://filters',
    {
      description: 'All Gmail filters with IDs and criteria.',
    },
    async () => {
      const result = await composed.getFilters();
      return {
        contents: [
          {
            uri: 'gmail://filters',
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
            text: JSON.stringify(account, null, 2),
          },
        ],
      };
    },
  );
}
