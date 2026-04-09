/**
 * Gmail Toolkit — MCP Draft Tools
 *
 * Get, create, delete, and send draft tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GmailClient } from '../client/index.js';
import type { LabelCache } from '../composed/labels.js';
import { getDrafts, createDraft, deleteDraft, sendDraft } from '../composed/index.js';
import type { ToolName, ToolConfig } from './tool-registry.js';
import { toMcpError } from './utils.js';

/**
 * Register all draft-related MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 */
export function registerDraftTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  client: GmailClient,
  labelCache: LabelCache,
): void {
  if (toolRegistry.gmail_get_drafts.enabled) {
    server.registerTool(
      'gmail_get_drafts',
      {
        description: toolRegistry.gmail_get_drafts.description,
        inputSchema: {
          max_results: z.number().optional().describe('Max drafts to return (default 10)'),
          query: z.string().optional().describe('Filter drafts by search query'),
          include_body: z
            .boolean()
            .optional()
            .describe('Include processed body text per draft (default false)'),
        },
      },
      async ({ max_results, query, include_body }) => {
        try {
          const result = await getDrafts(client, labelCache, max_results, query, include_body);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return toMcpError(err, 'gmail_get_drafts');
        }
      },
    );
  }

  if (toolRegistry.gmail_create_draft.enabled) {
    server.registerTool(
      'gmail_create_draft',
      {
        description: toolRegistry.gmail_create_draft.description,
        inputSchema: {
          body: z.string().describe('Email body text'),
          to: z.string().optional().describe('Recipient email address'),
          subject: z.string().optional().describe('Email subject'),
          cc: z.string().optional().describe('CC recipients'),
          bcc: z.string().optional().describe('BCC recipients'),
          content_type: z
            .enum(['text/plain', 'text/html'])
            .optional()
            .describe('Body content type'),
          thread_id: z.string().optional().describe('Thread ID for reply drafts'),
        },
      },
      async (params) => {
        try {
          const result = await createDraft(client, {
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
          return toMcpError(err, 'gmail_create_draft');
        }
      },
    );
  }

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
          const result = await deleteDraft(client, draft_id);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return toMcpError(err, 'gmail_delete_draft');
        }
      },
    );
  }

  if (toolRegistry.gmail_send_draft.enabled) {
    server.registerTool(
      'gmail_send_draft',
      {
        description: toolRegistry.gmail_send_draft.description,
        inputSchema: {
          draft_id: z.string().describe('Draft ID to send'),
        },
      },
      async ({ draft_id }) => {
        try {
          const result = await sendDraft(client, draft_id);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return toMcpError(err, 'gmail_send_draft');
        }
      },
    );
  }
}
