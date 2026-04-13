/**
 * Gmail Toolkit — MCP Delete Tools
 *
 * Trash, delete-label, delete-filter, and delete-draft tools (4 delete tools).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  toMcpError,
  toMcpResult,
  type ComposedClient,
  type ToolName,
  type ToolConfig,
} from './base.js';

/**
 * Register all delete MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param composed - The composed Layer 2 client
 */
export function registerDeleteTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  composed: ComposedClient,
): void {
  // ---------------------------------------------------------------------------
  // gmail_trash — move messages/threads to Trash
  // ---------------------------------------------------------------------------

  if (toolRegistry.gmail_trash.enabled) {
    server.registerTool(
      'gmail_trash',
      {
        description: toolRegistry.gmail_trash.description,
        inputSchema: {
          message_ids: z.array(z.string()).optional().describe('Message IDs to trash'),
          thread_ids: z.array(z.string()).optional().describe('Thread IDs to trash'),
        },
      },
      async ({ message_ids, thread_ids }) => {
        try {
          const result = await composed.trash({
            messageIds: message_ids,
            threadIds: thread_ids,
          });
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_trash');
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // gmail_delete_label — delete a label (messages NOT deleted)
  // ---------------------------------------------------------------------------

  if (toolRegistry.gmail_delete_label.enabled) {
    server.registerTool(
      'gmail_delete_label',
      {
        description: toolRegistry.gmail_delete_label.description,
        inputSchema: {
          label: z.string().describe('Label name or ID to delete'),
        },
      },
      async ({ label }) => {
        try {
          const result = await composed.deleteLabel(label);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_delete_label');
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // gmail_delete_filter — delete a filter rule
  // ---------------------------------------------------------------------------

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
          const result = await composed.deleteFilter(filter_id);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_delete_filter');
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // gmail_delete_draft — permanently delete a draft
  // ---------------------------------------------------------------------------

  if (toolRegistry.gmail_delete_draft.enabled) {
    server.registerTool(
      'gmail_delete_draft',
      {
        description: toolRegistry.gmail_delete_draft.description,
        inputSchema: {
          draft_id: z.string().describe('Draft ID to delete'),
        },
      },
      async ({ draft_id }) => {
        try {
          const result = await composed.deleteDraft(draft_id);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_delete_draft');
        }
      },
    );
  }
}
