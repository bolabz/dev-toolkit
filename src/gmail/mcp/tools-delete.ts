/**
 * Gmail Toolkit — MCP Delete Tools
 *
 * Trash, delete-label, delete-filter, and delete-draft tools (4 delete tools).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { withErrorHandling, type GmailToolkit, type ToolName, type ToolConfig } from './base.js';

/**
 * Register all delete MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param toolkit - The Gmail toolkit instance
 */
export function registerDeleteTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  toolkit: GmailToolkit,
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
      withErrorHandling('gmail_trash', async ({ message_ids, thread_ids }) =>
        toolkit.trash({ messageIds: message_ids, threadIds: thread_ids }),
      ),
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
      withErrorHandling('gmail_delete_label', async ({ label }) => toolkit.deleteLabel(label)),
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
      withErrorHandling('gmail_delete_filter', async ({ filter_id }) =>
        toolkit.deleteFilter(filter_id),
      ),
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
      withErrorHandling('gmail_delete_draft', async ({ draft_id }) =>
        toolkit.deleteDraft(draft_id),
      ),
    );
  }
}
