/**
 * Gmail Toolkit — MCP Message Tools
 *
 * Search, read, modify, trash, and send message tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GmailContext } from '../composed/context.js';
import {
  search,
  readMessage,
  modifyMessages,
  searchAndModify,
  trashMessages,
  sendMessage,
  getHistory,
  filterCriteriaToQuery,
} from '../composed/index.js';
import type { FilterCriteriaInput } from '../types.js';
import type { ToolName, ToolConfig } from './tool-registry.js';
import { toMcpError, toMcpResult } from './utils.js';

/**
 * Register all message-related MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param context - The authenticated Gmail context
 */
export function registerMessageTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  context: GmailContext,
): void {
  const { client, labelCache } = context;
  if (toolRegistry.gmail_search.enabled) {
    server.registerTool(
      'gmail_search',
      {
        description: toolRegistry.gmail_search.description,
        inputSchema: {
          query: z
            .string()
            .optional()
            .describe(
              'Gmail search query (e.g., "is:unread from:chase"). Combined with structured criteria if both provided.',
            ),
          from: z.string().optional().describe('Filter by sender email or name'),
          to: z.string().optional().describe('Filter by recipient'),
          subject: z.string().optional().describe('Filter by subject'),
          has_attachment: z.boolean().optional().describe('Filter for messages with attachments'),
          negated_query: z.string().optional().describe('Exclude messages matching this query'),
          size: z.number().optional().describe('Size threshold in bytes'),
          size_comparison: z
            .enum(['smaller', 'larger'])
            .optional()
            .describe('Match messages smaller or larger than size'),
          max_results: z.number().optional().describe('Max messages to return (default 20)'),
          page_token: z.string().optional().describe('Pagination token from previous search'),
          include_body: z
            .boolean()
            .optional()
            .describe(
              'Include processed body text per message (default false). Eliminates need for separate read calls.',
            ),
        },
      },
      async (params) => {
        try {
          // Build query from structured criteria + raw query
          const criteria: FilterCriteriaInput = {
            ...(params.from != null && { from: params.from }),
            ...(params.to != null && { to: params.to }),
            ...(params.subject != null && { subject: params.subject }),
            ...(params.has_attachment != null && { has_attachment: params.has_attachment }),
            ...(params.negated_query != null && { negated_query: params.negated_query }),
            ...(params.size != null && { size: params.size }),
            ...(params.size_comparison != null && { size_comparison: params.size_comparison }),
          };
          const criteriaQuery = filterCriteriaToQuery(criteria);
          const combinedQuery = [params.query, criteriaQuery].filter(Boolean).join(' ');

          const result = await search(
            client,
            labelCache,
            combinedQuery,
            params.max_results,
            params.page_token,
            params.include_body,
          );
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_search');
        }
      },
    );
  }

  if (toolRegistry.gmail_read_message.enabled) {
    server.registerTool(
      'gmail_read_message',
      {
        description: toolRegistry.gmail_read_message.description,
        inputSchema: {
          message_id: z.string().describe('Message ID from search results'),
          include_html: z.boolean().optional().describe('Include raw HTML body (default false)'),
        },
      },
      async ({ message_id, include_html }) => {
        try {
          const result = await readMessage(client, labelCache, message_id, include_html);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_read_message');
        }
      },
    );
  }

  if (toolRegistry.gmail_modify_messages.enabled) {
    server.registerTool(
      'gmail_modify_messages',
      {
        description: toolRegistry.gmail_modify_messages.description,
        inputSchema: {
          message_ids: z
            .array(z.string())
            .optional()
            .describe('Message IDs to modify (alternative to query-based mode)'),
          query: z
            .string()
            .optional()
            .describe('Gmail search query — modify all matching messages (alternative to IDs)'),
          from: z.string().optional().describe('Filter by sender (query mode)'),
          to: z.string().optional().describe('Filter by recipient (query mode)'),
          subject: z.string().optional().describe('Filter by subject (query mode)'),
          has_attachment: z
            .boolean()
            .optional()
            .describe('Filter for messages with attachments (query mode)'),
          max_messages: z
            .number()
            .optional()
            .describe('Max messages to modify in query mode (default 500, safety cap)'),
          add_labels: z.array(z.string()).optional().describe('Label names to add'),
          remove_labels: z.array(z.string()).optional().describe('Label names to remove'),
        },
      },
      async (params) => {
        try {
          let result;
          if (params.message_ids != null && params.message_ids.length > 0) {
            // ID-based mode (existing behavior)
            result = await modifyMessages(
              client,
              labelCache,
              params.message_ids,
              params.add_labels,
              params.remove_labels,
            );
          } else {
            // Query-based mode
            const criteria: FilterCriteriaInput = {
              ...(params.from != null && { from: params.from }),
              ...(params.to != null && { to: params.to }),
              ...(params.subject != null && { subject: params.subject }),
              ...(params.has_attachment != null && { has_attachment: params.has_attachment }),
            };
            const criteriaQuery = filterCriteriaToQuery(criteria);
            const combinedQuery = [params.query, criteriaQuery].filter(Boolean).join(' ');
            result = await searchAndModify(
              client,
              labelCache,
              combinedQuery,
              params.add_labels,
              params.remove_labels,
              params.max_messages,
            );
          }
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_modify_messages');
        }
      },
    );
  }

  if (toolRegistry.gmail_trash_messages.enabled) {
    server.registerTool(
      'gmail_trash_messages',
      {
        description: toolRegistry.gmail_trash_messages.description,
        inputSchema: {
          message_ids: z.array(z.string()).describe('Message IDs to trash'),
        },
      },
      async ({ message_ids }) => {
        try {
          const result = await trashMessages(client, message_ids);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_trash_messages');
        }
      },
    );
  }

  if (toolRegistry.gmail_send_message.enabled) {
    server.registerTool(
      'gmail_send_message',
      {
        description: toolRegistry.gmail_send_message.description,
        inputSchema: {
          to: z.string().describe('Recipient email'),
          subject: z.string().describe('Email subject'),
          body: z.string().describe('Email body'),
          cc: z.string().optional(),
          bcc: z.string().optional(),
          content_type: z.enum(['text/plain', 'text/html']).optional(),
          thread_id: z.string().optional(),
        },
      },
      async (params) => {
        try {
          const result = await sendMessage(client, {
            to: params.to,
            subject: params.subject,
            body: params.body,
            cc: params.cc,
            bcc: params.bcc,
            contentType: params.content_type,
            threadId: params.thread_id,
          });
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_send_message');
        }
      },
    );
  }

  if (toolRegistry.gmail_get_history.enabled) {
    server.registerTool(
      'gmail_get_history',
      {
        description: toolRegistry.gmail_get_history.description,
        inputSchema: {
          since_history_id: z
            .string()
            .describe(
              'History ID watermark to poll from — obtain from getAccount().history_id or readMessage().history_id',
            ),
          max_results: z.number().optional().describe('Max history records per page (default 100)'),
          page_token: z.string().optional().describe('Pagination token from previous call'),
        },
      },
      async ({ since_history_id, max_results, page_token }) => {
        try {
          const result = await getHistory(client, since_history_id, max_results, page_token);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_get_history');
        }
      },
    );
  }
}
