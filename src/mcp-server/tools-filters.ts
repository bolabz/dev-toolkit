/**
 * Gmail Toolkit — MCP Filter Tools
 *
 * Get, create, and delete filter tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GmailClient } from '../client/index.js';
import type { LabelCache } from '../composed/labels.js';
import { getFilters, createFilter, deleteFilter } from '../composed/index.js';
import type { ToolName, ToolConfig } from '../config/tools.js';
import { toMcpError } from './utils.js';

/**
 * Register all filter-related MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 */
export function registerFilterTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  client: GmailClient,
  labelCache: LabelCache,
): void {
  if (toolRegistry.gmail_get_filters.enabled) {
    server.registerTool(
      'gmail_get_filters',
      { description: toolRegistry.gmail_get_filters.description },
      async () => {
        try {
          const result = await getFilters(client, labelCache);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return toMcpError(err, 'gmail_get_filters');
        }
      },
    );
  }

  if (toolRegistry.gmail_create_filter.enabled) {
    server.registerTool(
      'gmail_create_filter',
      {
        description: toolRegistry.gmail_create_filter.description,
        inputSchema: {
          criteria: z
            .object({
              from: z.string().optional(),
              to: z.string().optional(),
              subject: z.string().optional(),
              query: z.string().optional(),
              has_attachment: z.boolean().optional(),
            })
            .describe('Filter matching criteria'),
          actions: z
            .object({
              add_labels: z.array(z.string()).optional(),
              remove_labels: z.array(z.string()).optional(),
              forward_to: z.string().optional(),
              skip_inbox: z.boolean().optional(),
              mark_read: z.boolean().optional(),
            })
            .describe('Actions to apply on matching messages'),
        },
      },
      async ({ criteria, actions }) => {
        try {
          const result = await createFilter(client, labelCache, criteria, actions);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return toMcpError(err, 'gmail_create_filter');
        }
      },
    );
  }

  if (toolRegistry.gmail_delete_filter.enabled) {
    server.registerTool(
      'gmail_delete_filter',
      {
        description: toolRegistry.gmail_delete_filter.description,
        inputSchema: {
          filter_id: z.string().describe('Filter ID to delete'),
        },
      },
      async ({ filter_id }) => {
        try {
          const result = await deleteFilter(client, filter_id);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return toMcpError(err, 'gmail_delete_filter');
        }
      },
    );
  }
}
