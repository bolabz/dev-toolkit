/**
 * Gmail Toolkit — MCP Read Tools
 *
 * Account, search, read, and get-drafts tools (4 read-only tools).
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
 * Register all read-only MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param composed - The composed Layer 2 client
 */
export function registerReadTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  composed: ComposedClient,
): void {
  // ---------------------------------------------------------------------------
  // gmail_account — full account context in one call
  // ---------------------------------------------------------------------------

  if (toolRegistry.gmail_account.enabled) {
    server.registerTool(
      'gmail_account',
      { description: toolRegistry.gmail_account.description },
      async () => {
        try {
          const result = await composed.getAccountContext();
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_account');
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // gmail_search — rich search with structured criteria + query
  // ---------------------------------------------------------------------------

  if (toolRegistry.gmail_search.enabled) {
    server.registerTool(
      'gmail_search',
      {
        description: toolRegistry.gmail_search.description,
        inputSchema: {
          query: z
            .string()
            .optional()
            .describe('Gmail search query (combined with structured filters)'),
          from: z.string().optional().describe('Filter by sender'),
          to: z.string().optional().describe('Filter by recipient'),
          subject: z.string().optional().describe('Filter by subject'),
          has_attachment: z.boolean().optional().describe('Filter for messages with attachments'),
          negated_query: z.string().optional().describe('Exclude messages matching this query'),
          size: z.number().optional().describe('Size threshold in bytes'),
          size_comparison: z
            .enum(['smaller', 'larger'])
            .optional()
            .describe('Match messages smaller or larger than size'),
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
        },
      },
      async (params) => {
        try {
          // Resolve filter_id to criteria query if provided
          let filterQuery = '';
          if (params.filter_id != null) {
            filterQuery = await composed.resolveFilterCriteria(params.filter_id);
          }

          // Build structured criteria query
          const criteria: SearchCriteriaInput = {
            ...(params.from != null && { from: params.from }),
            ...(params.to != null && { to: params.to }),
            ...(params.subject != null && { subject: params.subject }),
            ...(params.has_attachment != null && { has_attachment: params.has_attachment }),
            ...(params.negated_query != null && { negated_query: params.negated_query }),
            ...(params.size != null && { size: params.size }),
            ...(params.size_comparison != null && { size_comparison: params.size_comparison }),
            ...(params.after != null && { after: params.after }),
            ...(params.before != null && { before: params.before }),
            ...(params.labels != null && { labels: params.labels }),
            ...(params.exclude_labels != null && { exclude_labels: params.exclude_labels }),
            ...(params.is != null && { is: params.is }),
          };
          const criteriaQuery = filterCriteriaToQuery(criteria);

          const combinedQuery = [filterQuery, params.query, criteriaQuery]
            .filter(Boolean)
            .join(' ');

          const result = await composed.search(combinedQuery);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_search');
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // gmail_read — batch read messages with full body + thread context
  // ---------------------------------------------------------------------------

  if (toolRegistry.gmail_read.enabled) {
    server.registerTool(
      'gmail_read',
      {
        description: toolRegistry.gmail_read.description,
        inputSchema: {
          message_ids: z
            .array(z.string())
            .describe('Message IDs to read with full body and thread context'),
          include_html: z
            .boolean()
            .optional()
            .describe('Include raw HTML body alongside plain text (default false)'),
        },
      },
      async ({ message_ids, include_html }) => {
        try {
          const result = await composed.read(message_ids, { includeHtml: include_html });
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_read');
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // gmail_get_drafts — list all drafts with optional body
  // ---------------------------------------------------------------------------

  if (toolRegistry.gmail_get_drafts.enabled) {
    server.registerTool(
      'gmail_get_drafts',
      {
        description: toolRegistry.gmail_get_drafts.description,
        inputSchema: {
          query: z.string().optional().describe('Gmail search query to filter drafts'),
          include_body: z.boolean().optional().describe('Include draft body text (default false)'),
        },
      },
      async ({ query, include_body }) => {
        try {
          const result = await composed.getDrafts(query, include_body);
          return toMcpResult(result);
        } catch (err) {
          return toMcpError(err, 'gmail_get_drafts');
        }
      },
    );
  }
}
