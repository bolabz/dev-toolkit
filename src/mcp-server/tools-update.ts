/**
 * Gmail Toolkit — MCP Update Tools
 *
 * Modify, update-label, and update-filter tools (3 update tools).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  filterCriteriaToQuery,
  toMcpError,
  toMcpResult,
  type ComposedClient,
  type SearchCriteriaInput,
  type ToolName,
  type ToolConfig,
} from './base.js';

/**
 * Register all update MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param composed - The composed Layer 2 client
 */
export function registerUpdateTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  composed: ComposedClient,
): void {
  // ---------------------------------------------------------------------------
  // gmail_modify — add/remove labels on messages by IDs, thread IDs, or query
  // ---------------------------------------------------------------------------

  if (toolRegistry.gmail_modify.enabled) {
    server.registerTool(
      'gmail_modify',
      {
        description: toolRegistry.gmail_modify.description,
        inputSchema: {
          message_ids: z.array(z.string()).optional().describe('Message IDs to modify'),
          thread_ids: z
            .array(z.string())
            .optional()
            .describe('Thread IDs to modify (all messages in threads)'),
          query: z.string().optional().describe('Gmail query — modify all matching messages'),
          from: z.string().optional().describe('Filter by sender'),
          to: z.string().optional().describe('Filter by recipient'),
          subject: z.string().optional().describe('Filter by subject'),
          has_attachment: z.boolean().optional().describe('Filter for messages with attachments'),
          negated_query: z.string().optional().describe('Exclude messages matching this query'),
          after: z
            .string()
            .optional()
            .describe('Messages after this date (YYYY-MM-DD or ISO 8601)'),
          before: z
            .string()
            .optional()
            .describe('Messages before this date (YYYY-MM-DD or ISO 8601)'),
          labels: z.array(z.string()).optional().describe('Include messages with these labels'),
          exclude_labels: z
            .array(z.string())
            .optional()
            .describe('Exclude messages with these labels'),
          is: z
            .enum(['unread', 'read', 'starred', 'important', 'snoozed'])
            .optional()
            .describe('Filter by message status'),
          filter_id: z
            .string()
            .optional()
            .describe('Apply existing filter criteria as search terms'),
          add_labels: z.array(z.string()).optional().describe('Label names to apply'),
          remove_labels: z.array(z.string()).optional().describe('Label names to remove'),
        },
      },
      async (params) => {
        try {
          const targets: { messageIds?: string[]; threadIds?: string[]; query?: string } = {};

          if (params.message_ids != null && params.message_ids.length > 0) {
            targets.messageIds = params.message_ids;
          }
          if (params.thread_ids != null && params.thread_ids.length > 0) {
            targets.threadIds = params.thread_ids;
          }

          // Build query from structured criteria + filter_id if no direct IDs
          if (targets.messageIds == null && targets.threadIds == null) {
            let filterQuery = '';
            if (params.filter_id != null) {
              filterQuery = await composed.resolveFilterCriteria(params.filter_id);
            }

            const criteria: SearchCriteriaInput = {
              ...(params.from != null && { from: params.from }),
              ...(params.to != null && { to: params.to }),
              ...(params.subject != null && { subject: params.subject }),
              ...(params.has_attachment != null && { has_attachment: params.has_attachment }),
              ...(params.negated_query != null && { negated_query: params.negated_query }),
              ...(params.after != null && { after: params.after }),
              ...(params.before != null && { before: params.before }),
              ...(params.labels != null && { labels: params.labels }),
              ...(params.exclude_labels != null && { exclude_labels: params.exclude_labels }),
              ...(params.is != null && { is: params.is }),
            };
            const criteriaQuery = filterCriteriaToQuery(criteria);

            targets.query = [filterQuery, params.query, criteriaQuery].filter(Boolean).join(' ');
          }

          const result = await composed.modify(targets, params.add_labels, params.remove_labels);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_modify');
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // gmail_update_label — update a label name or color
  // ---------------------------------------------------------------------------

  if (toolRegistry.gmail_update_label.enabled) {
    server.registerTool(
      'gmail_update_label',
      {
        description: toolRegistry.gmail_update_label.description,
        inputSchema: {
          label: z.string().describe('Label name or ID to update'),
          new_name: z.string().optional().describe('New name for the label'),
          color: z
            .object({
              text: z.string(),
              background: z.string(),
            })
            .optional()
            .describe('New color'),
        },
      },
      async ({ label, new_name, color }) => {
        try {
          const result = await composed.updateLabel(label, { new_name, color });
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_update_label');
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // gmail_update_filter — atomic delete+recreate with merged criteria/actions
  // ---------------------------------------------------------------------------

  if (toolRegistry.gmail_update_filter.enabled) {
    server.registerTool(
      'gmail_update_filter',
      {
        description: toolRegistry.gmail_update_filter.description,
        inputSchema: {
          filter_id: z.string().describe('Filter ID to update'),
          criteria: z
            .object({
              from: z.string().optional(),
              to: z.string().optional(),
              subject: z.string().optional(),
              query: z.string().optional(),
              negated_query: z.string().optional(),
              has_attachment: z.boolean().optional(),
              size: z.number().optional(),
              size_comparison: z.enum(['smaller', 'larger']).optional(),
            })
            .optional()
            .describe('Criteria fields to merge with existing filter'),
          actions: z
            .object({
              add_labels: z.array(z.string()).optional(),
              remove_labels: z.array(z.string()).optional(),
              forward_to: z.string().optional(),
              skip_inbox: z.boolean().optional(),
              mark_read: z.boolean().optional(),
            })
            .optional()
            .describe('Action fields to merge with existing filter'),
        },
      },
      async ({ filter_id, criteria, actions }) => {
        try {
          const result = await composed.updateFilter(filter_id, criteria, actions);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_update_filter');
        }
      },
    );
  }
}
