/**
 * Gmail Toolkit — MCP Thread Tools
 *
 * Read, modify, and trash thread tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GmailClient } from '../client/index.js';
import type { LabelCache } from '../composed/labels.js';
import { readThread, modifyThread, trashThread } from '../composed/index.js';
import type { ToolName, ToolConfig } from '../config/tools.js';
import { toMcpError } from './utils.js';

/**
 * Register all thread-related MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 */
export function registerThreadTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  client: GmailClient,
  labelCache: LabelCache,
): void {
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
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
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
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
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
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return toMcpError(err, 'gmail_trash_thread');
        }
      },
    );
  }
}
