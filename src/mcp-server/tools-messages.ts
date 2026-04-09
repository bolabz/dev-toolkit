/**
 * Gmail Toolkit — MCP Message Tools
 *
 * Search, read, modify, trash, and send message tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GmailClient } from '../client/index.js';
import type { LabelCache } from '../composed/labels.js';
import {
  search,
  readMessage,
  modifyMessages,
  trashMessages,
  sendMessage,
} from '../composed/index.js';
import type { ToolName } from '../config/tools.js';
import type { ToolConfig } from '../config/tools.js';
import { toMcpError } from './utils.js';

/**
 * Register all message-related MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 */
export function registerMessageTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  client: GmailClient,
  labelCache: LabelCache,
): void {
  if (toolRegistry.gmail_search.enabled) {
    server.registerTool(
      'gmail_search',
      {
        description: toolRegistry.gmail_search.description,
        inputSchema: {
          query: z.string().describe('Gmail search query (e.g., "is:unread from:chase")'),
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
      async ({ query, max_results, page_token, include_body }) => {
        try {
          const result = await search(
            client,
            labelCache,
            query,
            max_results,
            page_token,
            include_body,
          );
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
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
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
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
          message_ids: z.array(z.string()).describe('Message IDs to modify'),
          add_labels: z.array(z.string()).optional().describe('Label names to add'),
          remove_labels: z.array(z.string()).optional().describe('Label names to remove'),
        },
      },
      async ({ message_ids, add_labels, remove_labels }) => {
        try {
          const result = await modifyMessages(
            client,
            labelCache,
            message_ids,
            add_labels,
            remove_labels,
          );
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
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
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
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
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return toMcpError(err, 'gmail_send_message');
        }
      },
    );
  }
}
