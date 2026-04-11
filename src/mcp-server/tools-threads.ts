/**
 * Gmail Toolkit — MCP Thread Tools
 *
 * Search, read, modify, and trash thread tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GmailContext } from '../composed/context.js';
import { readThread, modifyThread, trashThread, searchThreads } from '../composed/index.js';
import type { ToolName, ToolConfig } from './tool-registry.js';
import { toMcpError, toMcpResult } from './utils.js';

/**
 * Register all thread-related MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param context - The authenticated Gmail context
 */
export function registerThreadTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  context: GmailContext,
): void {
  const { client, labelCache } = context;
  if (toolRegistry.gmail_read_thread.enabled) {
    server.registerTool(
      'gmail_read_thread',
      {
        description: toolRegistry.gmail_read_thread.description,
        inputSchema: {
          thread_id: z.string().describe('Thread ID from search results or message'),
        },
      },
      async ({ thread_id }) => {
        try {
          const result = await readThread(client, labelCache, thread_id);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_read_thread');
        }
      },
    );
  }

  if (toolRegistry.gmail_modify_thread.enabled) {
    server.registerTool(
      'gmail_modify_thread',
      {
        description: toolRegistry.gmail_modify_thread.description,
        inputSchema: {
          thread_id: z.string().describe('Thread ID to modify'),
          add_labels: z.array(z.string()).optional().describe('Label names to add'),
          remove_labels: z.array(z.string()).optional().describe('Label names to remove'),
        },
      },
      async ({ thread_id, add_labels, remove_labels }) => {
        try {
          const result = await modifyThread(
            client,
            labelCache,
            thread_id,
            add_labels,
            remove_labels,
          );
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_modify_thread');
        }
      },
    );
  }

  if (toolRegistry.gmail_trash_thread.enabled) {
    server.registerTool(
      'gmail_trash_thread',
      {
        description: toolRegistry.gmail_trash_thread.description,
        inputSchema: {
          thread_id: z.string().describe('Thread ID to trash'),
        },
      },
      async ({ thread_id }) => {
        try {
          const result = await trashThread(client, thread_id);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_trash_thread');
        }
      },
    );
  }

  if (toolRegistry.gmail_search_threads.enabled) {
    server.registerTool(
      'gmail_search_threads',
      {
        description: toolRegistry.gmail_search_threads.description,
        inputSchema: {
          query: z.string().describe('Gmail search query (e.g., "is:unread label:finance")'),
          max_results: z.number().optional().describe('Max threads to return (default 20)'),
          page_token: z.string().optional().describe('Pagination token from previous search'),
          enrich: z
            .boolean()
            .optional()
            .describe(
              'Fetch message counts, subjects, and participants per thread (default false). Adds one API call per thread.',
            ),
        },
      },
      async ({ query, max_results, page_token, enrich }) => {
        try {
          const result = await searchThreads(client, query, max_results, page_token, enrich);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_search_threads');
        }
      },
    );
  }
}
