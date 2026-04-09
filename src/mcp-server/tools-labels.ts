/**
 * Gmail Toolkit — MCP Label Tools
 *
 * Get, create, update, and delete label tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GmailClient } from '../client/index.js';
import type { LabelCache } from '../composed/labels.js';
import { getLabels, createLabel, updateLabel, deleteLabel } from '../composed/index.js';
import type { ToolName, ToolConfig } from './tool-registry.js';
import { toMcpError } from './utils.js';

/**
 * Register all label-related MCP tools.
 * @param server - The MCP server instance
 * @param toolRegistry - The tool configuration registry
 * @param client - The authenticated Gmail API client
 * @param labelCache - The label name-to-ID resolution cache
 */
export function registerLabelTools(
  server: McpServer,
  toolRegistry: Record<ToolName, ToolConfig>,
  client: GmailClient,
  labelCache: LabelCache,
): void {
  if (toolRegistry.gmail_get_labels.enabled) {
    server.registerTool(
      'gmail_get_labels',
      { description: toolRegistry.gmail_get_labels.description },
      async () => {
        try {
          const result = await getLabels(client, labelCache);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return toMcpError(err, 'gmail_get_labels');
        }
      },
    );
  }

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
          const result = await createLabel(client, labelCache, name, { color });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return toMcpError(err, 'gmail_create_label');
        }
      },
    );
  }

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
          const result = await updateLabel(client, labelCache, label, { new_name, color });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return toMcpError(err, 'gmail_update_label');
        }
      },
    );
  }

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
          const result = await deleteLabel(client, labelCache, label);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return toMcpError(err, 'gmail_delete_label');
        }
      },
    );
  }
}
