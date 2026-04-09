#!/usr/bin/env node

/**
 * Gmail Toolkit — MCP Server (Layer 3)
 *
 * Configuration-driven tool/resource/prompt registry.
 * Thin wrapper: Zod schemas → composed operations.
 *
 * Entry point: npx gmail-toolkit --mcp
 * Transport: stdio (for Claude Desktop / any MCP host)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { ensureAuthenticated } from './auth.js';
import { logger } from './logger.js';
import { GmailClient } from './client/index.js';
import { GmailApiError, GmailValidationError } from './errors.js';
import type { GmailToolkitError } from './types.js';

const log = logger.child('mcp');
import {
  LabelCache,
  search,
  readMessage,
  readThread,
  getLabels,
  getDrafts,
  getFilters,
  getAccount,
  createLabel,
  updateLabel,
  modifyMessages,
  modifyThread,
  createDraft,
  createFilter,
  trashMessages,
  trashThread,
  deleteLabel,
  deleteFilter,
  deleteDraft,
  sendDraft,
  sendMessage,
} from './composed/index.js';
import { resolveToolRegistry, type ToolName } from './config/tools.js';

// ---------------------------------------------------------------------------
// Server Initialization
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'gmail-toolkit',
  version: '0.1.0',
});

// These are initialized in startServer() after auth
let client: GmailClient;
let labelCache: LabelCache;

// ---------------------------------------------------------------------------
// Helper: check if a tool is enabled
// ---------------------------------------------------------------------------

const toolRegistry = resolveToolRegistry();

function isEnabled(name: ToolName): boolean {
  return toolRegistry[name].enabled;
}

// ---------------------------------------------------------------------------
// Helper: serialise caught errors into MCP tool error responses
// ---------------------------------------------------------------------------

/**
 * Convert any caught error into an MCP tool result with `isError: true`.
 * Populates the `GmailToolkitError` DTO shape so callers get structured info.
 * @param err - The caught error (any type — will be narrowed internally)
 * @param toolName - The MCP tool name used as fallback operation label
 * @returns An MCP tool result object with `isError: true` and JSON error content
 */
function toMcpError(
  err: unknown,
  toolName: string,
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const errorDto: GmailToolkitError = {
    code: err instanceof GmailApiError ? err.code : 0,
    message: err instanceof Error ? err.message : String(err),
    operation:
      err instanceof GmailApiError
        ? err.operation
        : err instanceof GmailValidationError
          ? err.operation
          : toolName,
    retryable: err instanceof GmailApiError ? err.retryable : false,
    ...(err instanceof GmailValidationError && err.field !== undefined && err.field !== ''
      ? { field: err.field }
      : {}),
  };
  log.error(`Tool error [${toolName}]: ${errorDto.message}`);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(errorDto, null, 2) }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Read Tools
// ---------------------------------------------------------------------------

if (isEnabled('gmail_search')) {
  server.tool(
    'gmail_search',
    toolRegistry.gmail_search.description,
    {
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

if (isEnabled('gmail_read_message')) {
  server.tool(
    'gmail_read_message',
    toolRegistry.gmail_read_message.description,
    {
      message_id: z.string().describe('Message ID from search results'),
      include_html: z.boolean().optional().describe('Include raw HTML body (default false)'),
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

if (isEnabled('gmail_read_thread')) {
  server.tool(
    'gmail_read_thread',
    toolRegistry.gmail_read_thread.description,
    {
      thread_id: z.string().describe('Thread ID from search results or message'),
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

if (isEnabled('gmail_get_labels')) {
  server.tool('gmail_get_labels', toolRegistry.gmail_get_labels.description, {}, async () => {
    try {
      const result = await getLabels(client, labelCache);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return toMcpError(err, 'gmail_get_labels');
    }
  });
}

if (isEnabled('gmail_get_drafts')) {
  server.tool(
    'gmail_get_drafts',
    toolRegistry.gmail_get_drafts.description,
    {
      max_results: z.number().optional().describe('Max drafts to return (default 10)'),
      query: z.string().optional().describe('Filter drafts by search query'),
      include_body: z
        .boolean()
        .optional()
        .describe('Include processed body text per draft (default false)'),
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

if (isEnabled('gmail_get_filters')) {
  server.tool('gmail_get_filters', toolRegistry.gmail_get_filters.description, {}, async () => {
    try {
      const result = await getFilters(client, labelCache);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return toMcpError(err, 'gmail_get_filters');
    }
  });
}

if (isEnabled('gmail_get_account')) {
  server.tool('gmail_get_account', toolRegistry.gmail_get_account.description, {}, async () => {
    try {
      const result = await getAccount(client);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return toMcpError(err, 'gmail_get_account');
    }
  });
}

// ---------------------------------------------------------------------------
// Write Tools — Non-Destructive
// ---------------------------------------------------------------------------

if (isEnabled('gmail_create_label')) {
  server.tool(
    'gmail_create_label',
    toolRegistry.gmail_create_label.description,
    {
      name: z.string().describe('Label name (use "/" for nesting, e.g., "Finance/Banking")'),
      color: z
        .object({
          text: z.string(),
          background: z.string(),
        })
        .optional()
        .describe('Label color'),
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

if (isEnabled('gmail_update_label')) {
  server.tool(
    'gmail_update_label',
    toolRegistry.gmail_update_label.description,
    {
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

if (isEnabled('gmail_modify_messages')) {
  server.tool(
    'gmail_modify_messages',
    toolRegistry.gmail_modify_messages.description,
    {
      message_ids: z.array(z.string()).describe('Message IDs to modify'),
      add_labels: z.array(z.string()).optional().describe('Label names to add'),
      remove_labels: z.array(z.string()).optional().describe('Label names to remove'),
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

if (isEnabled('gmail_modify_thread')) {
  server.tool(
    'gmail_modify_thread',
    toolRegistry.gmail_modify_thread.description,
    {
      thread_id: z.string().describe('Thread ID to modify'),
      add_labels: z.array(z.string()).optional().describe('Label names to add'),
      remove_labels: z.array(z.string()).optional().describe('Label names to remove'),
    },
    async ({ thread_id, add_labels, remove_labels }) => {
      try {
        const result = await modifyThread(client, labelCache, thread_id, add_labels, remove_labels);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err, 'gmail_modify_thread');
      }
    },
  );
}

if (isEnabled('gmail_create_draft')) {
  server.tool(
    'gmail_create_draft',
    toolRegistry.gmail_create_draft.description,
    {
      body: z.string().describe('Email body text'),
      to: z.string().optional().describe('Recipient email address'),
      subject: z.string().optional().describe('Email subject'),
      cc: z.string().optional().describe('CC recipients'),
      bcc: z.string().optional().describe('BCC recipients'),
      content_type: z.enum(['text/plain', 'text/html']).optional().describe('Body content type'),
      thread_id: z.string().optional().describe('Thread ID for reply drafts'),
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

if (isEnabled('gmail_create_filter')) {
  server.tool(
    'gmail_create_filter',
    toolRegistry.gmail_create_filter.description,
    {
      criteria: z
        .object({
          from: z.string().optional(),
          to: z.string().optional(),
          subject: z.string().optional(),
          query: z.string().optional(),
          has_attachment: z.boolean().optional(),
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
    async ({ criteria, actions }) => {
      try {
        const result = await createFilter(client, labelCache, criteria, actions);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err, 'gmail_create_filter');
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Write Tools — Destructive (disabled by default)
// ---------------------------------------------------------------------------

if (isEnabled('gmail_send_draft')) {
  server.tool(
    'gmail_send_draft',
    toolRegistry.gmail_send_draft.description,
    { draft_id: z.string().describe('Draft ID to send') },
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

if (isEnabled('gmail_send_message')) {
  server.tool(
    'gmail_send_message',
    toolRegistry.gmail_send_message.description,
    {
      to: z.string().describe('Recipient email'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Email body'),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      content_type: z.enum(['text/plain', 'text/html']).optional(),
      thread_id: z.string().optional(),
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

if (isEnabled('gmail_trash_messages')) {
  server.tool(
    'gmail_trash_messages',
    toolRegistry.gmail_trash_messages.description,
    { message_ids: z.array(z.string()).describe('Message IDs to trash') },
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

if (isEnabled('gmail_trash_thread')) {
  server.tool(
    'gmail_trash_thread',
    toolRegistry.gmail_trash_thread.description,
    { thread_id: z.string().describe('Thread ID to trash') },
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

if (isEnabled('gmail_delete_label')) {
  server.tool(
    'gmail_delete_label',
    toolRegistry.gmail_delete_label.description,
    { label: z.string().describe('Label name or ID to delete') },
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

if (isEnabled('gmail_delete_filter')) {
  server.tool(
    'gmail_delete_filter',
    toolRegistry.gmail_delete_filter.description,
    { filter_id: z.string().describe('Filter ID to delete') },
    async ({ filter_id }) => {
      try {
        const result = await deleteFilter(client, filter_id);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return toMcpError(err, 'gmail_delete_filter');
      }
    },
  );
}

if (isEnabled('gmail_delete_draft')) {
  server.tool(
    'gmail_delete_draft',
    toolRegistry.gmail_delete_draft.description,
    { draft_id: z.string().describe('Draft ID to delete') },
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

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

server.resource(
  'labels',
  'gmail://labels',
  {
    description:
      'All Gmail labels with IDs, names, types, and counts. Use to resolve label names and understand organizational structure.',
  },
  async () => {
    const result = await getLabels(client, labelCache);
    return {
      contents: [
        {
          uri: 'gmail://labels',
          mimeType: 'application/json',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

server.resource(
  'profile',
  'gmail://profile',
  { description: 'Account email, total message/thread counts, history ID.' },
  async () => {
    const profile = await client.settings.getProfile();
    return {
      contents: [
        {
          uri: 'gmail://profile',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              email: profile.emailAddress,
              messages_total: profile.messagesTotal,
              threads_total: profile.threadsTotal,
              history_id: profile.historyId,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

server.prompt(
  'inbox_triage',
  'Search for urgent items, categorize by priority, surface emails needing action',
  {
    days: z.string().optional().describe('Number of days to look back (default 7)'),
    focus: z.string().optional().describe('Focus area: financial, personal, work, or all'),
  },
  ({ days, focus }) => ({
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text:
            `Please triage my inbox for the last ${days ?? '7'} days${focus != null && focus !== 'all' ? `, focusing on ${focus} emails` : ''}.\n\n` +
            `1. Search for unread messages from the last ${days ?? '7'} days\n` +
            `2. Categorize by urgency: immediate action needed, respond soon, FYI/low priority\n` +
            `3. For each urgent item, explain why it needs attention\n` +
            `4. Suggest labels or actions for organization`,
        },
      },
    ],
  }),
);

server.prompt(
  'financial_summary',
  'Find statements, bills, payments, trade confirmations; extract key amounts and dates',
  {
    days: z.string().optional().describe('Number of days to look back (default 30)'),
  },
  ({ days }) => ({
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text:
            `Please summarize my financial emails from the last ${days ?? '30'} days.\n\n` +
            `1. Search for emails from banks, credit cards, brokerages, and payment services\n` +
            `2. Extract: amounts, due dates, account references, confirmation numbers\n` +
            `3. Flag any bills due soon or unusual activity\n` +
            `4. Organize by category (banking, credit cards, investments, payments)`,
        },
      },
    ],
  }),
);

server.prompt(
  'newsletter_audit',
  'Identify subscription senders, frequency, and read rates; recommend unsubscribes',
  {
    days: z.string().optional().describe('Number of days to look back (default 30)'),
  },
  ({ days }) => ({
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text:
            `Please audit my newsletter and subscription emails from the last ${days ?? '30'} days.\n\n` +
            `1. Search for newsletters, marketing emails, and subscriptions\n` +
            `2. List each sender with: frequency, read rate (unread vs total), last opened\n` +
            `3. Recommend unsubscribes for low-engagement senders\n` +
            `4. Suggest filters to auto-organize the ones I keep`,
        },
      },
    ],
  }),
);

server.prompt(
  'reply_needed',
  'Find emails from real people that likely need a human response',
  {
    days: z.string().optional().describe('Number of days to look back (default 14)'),
  },
  ({ days }) => ({
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text:
            `Please find emails from the last ${days ?? '14'} days that likely need my reply.\n\n` +
            `1. Search for emails from real people (not automated/marketing senders)\n` +
            `2. Filter to emails that contain questions, requests, or expect a response\n` +
            `3. Prioritize by: how long ago it was received, sender importance, urgency\n` +
            `4. For each, draft a suggested reply or suggest what to say`,
        },
      },
    ],
  }),
);

server.prompt(
  'label_health_check',
  'Audit label system: find empty/overlapping labels, unlabeled important mail, suggest improvements',
  () => ({
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text:
            `Please audit my Gmail label system.\n\n` +
            `1. Get all labels with counts\n` +
            `2. Identify: empty labels, labels with very few messages, redundant/overlapping labels\n` +
            `3. Check for important mail that's unlabeled (search for unread in inbox without user labels)\n` +
            `4. Suggest label consolidation, new labels, or filters to improve organization`,
        },
      },
    ],
  }),
);

// ---------------------------------------------------------------------------
// Server Startup
// ---------------------------------------------------------------------------

async function startServer() {
  // Resolve credential paths from env vars or defaults
  const credentialsPath = process.env.GMAIL_CREDENTIALS_PATH ?? './credentials.json';
  const tokenPath = process.env.GMAIL_TOKEN_PATH ?? './token.json';

  // Seamless auth — handles all states (no token, expired, revoked)
  const auth = await ensureAuthenticated(credentialsPath, tokenPath);

  // Initialize Layer 1 client and Layer 2 cache
  client = new GmailClient(auth);
  labelCache = new LabelCache(client);

  // Log enabled tools
  const enabledTools = Object.entries(toolRegistry)
    .filter(([, config]) => config.enabled)
    .map(([name]) => name);
  log.info(`Starting MCP server with ${enabledTools.length} tools enabled`);

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

startServer().catch((err: unknown) => {
  log.error('Failed to start:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
