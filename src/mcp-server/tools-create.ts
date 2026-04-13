/**
 * Gmail Toolkit — MCP Create Tools
 *
 * Compose, create-label, and create-filter tools (3 create tools).
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
 * Register all create MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param composed - The composed Layer 2 client
 */
export function registerCreateTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  composed: ComposedClient,
): void {
  // ---------------------------------------------------------------------------
  // gmail_compose — create/update draft, send message, send draft (4 modes)
  // ---------------------------------------------------------------------------

  if (toolRegistry.gmail_compose.enabled) {
    server.registerTool(
      'gmail_compose',
      {
        description: toolRegistry.gmail_compose.description,
        inputSchema: {
          mode: z.enum(['draft', 'update_draft', 'send', 'send_draft']).describe('Compose mode'),
          body: z.string().optional().describe('Email body (required for draft/update_draft/send)'),
          to: z.string().optional().describe('Recipient (required for send mode)'),
          subject: z.string().optional().describe('Subject (required for send mode)'),
          cc: z.string().optional().describe('CC recipients'),
          bcc: z.string().optional().describe('BCC recipients'),
          content_type: z
            .enum(['text/plain', 'text/html'])
            .optional()
            .describe('Body content type'),
          thread_id: z.string().optional().describe('Thread ID for replies'),
          draft_id: z
            .string()
            .optional()
            .describe('Draft ID (required for update_draft and send_draft modes)'),
        },
      },
      async (params) => {
        try {
          const result = await composed.compose({
            mode: params.mode,
            body: params.body,
            to: params.to,
            subject: params.subject,
            cc: params.cc,
            bcc: params.bcc,
            content_type: params.content_type,
            thread_id: params.thread_id,
            draft_id: params.draft_id,
          } as Parameters<ComposedClient['compose']>[0]);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_compose');
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // gmail_create_label — create a new label
  // ---------------------------------------------------------------------------

  if (toolRegistry.gmail_create_label.enabled) {
    server.registerTool(
      'gmail_create_label',
      {
        description: toolRegistry.gmail_create_label.description,
        inputSchema: {
          name: z.string().describe('Label name (use "/" for nesting, e.g., "Finance/Banking")'),
          color: z
            .object({
              text: z.string(),
              background: z.string(),
            })
            .optional()
            .describe('Label color'),
        },
      },
      async ({ name, color }) => {
        try {
          const result = await composed.createLabel(name, { color });
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_create_label');
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // gmail_create_filter — create a new filter rule
  // ---------------------------------------------------------------------------

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
              negated_query: z.string().optional(),
              has_attachment: z.boolean().optional(),
              size: z.number().optional(),
              size_comparison: z.enum(['smaller', 'larger']).optional(),
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
          const result = await composed.createFilter(criteria, actions);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_create_filter');
        }
      },
    );
  }
}
