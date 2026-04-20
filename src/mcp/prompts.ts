/**
 * Gmail Toolkit — MCP Prompts
 *
 * Pre-built prompt templates for common Gmail workflows.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Register all MCP prompt templates.
 * @param server - The MCP server instance
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'inbox_triage',
    {
      description: 'Search for urgent items, categorize by priority, surface emails needing action',
      argsSchema: {
        days: z.string().optional().describe('Number of days to look back (default 7)'),
        focus: z.string().optional().describe('Focus area: financial, personal, work, or all'),
      },
    },
    ({ days, focus }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Please triage my inbox for the last ${days ?? '7'} days${focus != null && focus !== 'all' ? `, focusing on ${focus} emails` : ''}.\n\n` +
              `1. Start with gmail_account for label/filter context\n` +
              `2. Search for unread messages from the last ${days ?? '7'} days\n` +
              `3. Use the search summary's domain rollup and category breakdown to identify patterns\n` +
              `4. Use per-sender read rates to spot low-engagement senders vs important ones\n` +
              `5. Categorize by urgency: immediate action needed, respond soon, FYI/low priority\n` +
              `6. For each urgent item, explain why it needs attention\n` +
              `7. Suggest labels or filters for organization`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'financial_summary',
    {
      description:
        'Find statements, bills, payments, trade confirmations; extract key amounts and dates',
      argsSchema: {
        days: z.string().optional().describe('Number of days to look back (default 30)'),
      },
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

  server.registerPrompt(
    'newsletter_audit',
    {
      description:
        'Identify subscription senders, frequency, and read rates; recommend unsubscribes',
      argsSchema: {
        days: z.string().optional().describe('Number of days to look back (default 30)'),
      },
    },
    ({ days }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Please audit my newsletter and subscription emails from the last ${days ?? '30'} days.\n\n` +
              `1. Search for mailing list emails (is:unread OR is:read, from newsletters/subscriptions)\n` +
              `2. Use the search summary's read_rate_by_sender to identify low-engagement senders\n` +
              `3. Use domain rollup to group related senders (e.g. multiple addresses from the same service)\n` +
              `4. Use the date histogram to spot senders whose volume increased recently\n` +
              `5. Recommend unsubscribes for senders with low read rates\n` +
              `6. Suggest filters to auto-organize the ones worth keeping`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'reply_needed',
    {
      description: 'Find emails from real people that likely need a human response',
      argsSchema: {
        days: z.string().optional().describe('Number of days to look back (default 14)'),
      },
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

  server.registerPrompt(
    'label_health_check',
    {
      description:
        'Audit label system: find empty/overlapping labels, unlabeled important mail, suggest improvements',
    },
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
}
