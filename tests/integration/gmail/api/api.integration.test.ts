/**
 * Layer 2 — API Integration Tests
 *
 * Exercises L2 composed operations against the live Gmail API.
 * Validates that the transform pipeline produces correct domain types,
 * label resolution works, and search analytics are computed from real data.
 *
 * Requires: credentials.json + token.json (OAuth2 configured)
 * Run:      npm run test:integration
 */

import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { GmailToolkit } from '../../../../src/gmail/api/index.js';
import type { GmailContext } from '../../../../src/gmail/api/context.js';
import { createGmailContext } from '../../../../src/gmail/api/context.js';

const HAS_CREDENTIALS = fs.existsSync('credentials.json') && fs.existsSync('token.json');

describe.skipIf(!HAS_CREDENTIALS)('L2 API — Live Gmail', () => {
  let toolkit: GmailToolkit;
  let ctx: GmailContext;

  beforeAll(async () => {
    ctx = await createGmailContext();
    const { buildOps } = await import('../../../../src/gmail/api/index.js');
    toolkit = buildOps(ctx);
  });

  afterAll(() => {
    ctx.client.destroy?.();
  });

  // -------------------------------------------------------------------------
  // search — the most complex L2 operation
  // -------------------------------------------------------------------------

  describe('search', () => {
    it('returns thread-grouped results with analytics from real mail', async () => {
      const result = await toolkit.search('newer_than:7d');

      expect(result.total_messages).toBeGreaterThanOrEqual(0);
      expect(result.total_threads).toBeGreaterThanOrEqual(0);
      expect(result.threads).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.summary.senders).toBeDefined();
      expect(result.summary.labels).toBeDefined();
      expect(result.summary.thread_depth).toBeDefined();

      console.log(`  Total messages: ${result.total_messages}`);
      console.log(`  Total threads: ${result.total_threads}`);
      console.log(`  Unread: ${result.summary.unread_count}`);
      console.log(`  Unique senders: ${result.summary.senders.length}`);

      if (result.threads.length > 0) {
        console.log('\n  Top 5 threads:');
        console.table(
          result.threads.slice(0, 5).map((t) => ({
            subject: t.subject.slice(0, 50),
            messages: t.message_count,
            matched: t.matched_count,
            unread: t.has_unread,
            participants: t.participants.length,
          })),
        );
      }

      if (result.summary.senders.length > 0) {
        console.log('\n  Top 5 senders:');
        console.table(result.summary.senders.slice(0, 5));
      }

      // Verify domain type shape — these fields come from the transform pipeline
      if (result.threads.length > 0) {
        const thread = result.threads[0];
        expect(thread.id).toBeTruthy();
        expect(thread.subject).toBeDefined();
        expect(thread.participants).toBeInstanceOf(Array);
        expect(thread.date_range).toHaveProperty('first');

        if (thread.matched_messages.length > 0) {
          const msg = thread.matched_messages[0];
          expect(msg.from).toHaveProperty('email');
          expect(msg.labels).toBeInstanceOf(Array);
          expect(typeof msg.is_unread).toBe('boolean');
          expect(typeof msg.size_bytes).toBe('number');
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // read — full message retrieval with body processing
  // -------------------------------------------------------------------------

  describe('read', () => {
    it('returns full messages with processed body text and thread context', async () => {
      // Get a few message IDs to read
      const { messages } = await ctx.client.messages.list({ maxResults: 3 });
      if (messages.length === 0) {
        console.log('  No messages to read');
        return;
      }

      const result = await toolkit.read(messages.map((m) => m.id));

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);

      for (const thread of result) {
        // Thread-level fields
        expect(thread.id).toBeTruthy();
        expect(thread.subject).toBeDefined();
        expect(thread.participants).toBeInstanceOf(Array);
        expect(thread.message_count).toBeGreaterThan(0);
        expect(thread.date_range).toHaveProperty('first');

        // Message-level fields (FullMessage domain type)
        for (const entry of thread.messages) {
          const msg = entry.message;
          expect(msg.id).toBeTruthy();
          expect(msg.from).toHaveProperty('email');
          expect(msg.to).toBeInstanceOf(Array);
          expect(msg.subject).toBeDefined();
          expect(msg.date).toBeTruthy();
          expect(msg.labels).toBeInstanceOf(Array);
          expect(typeof msg.body_text).toBe('string');
          expect(msg.web_url).toContain('mail.google.com');
        }
      }

      console.log(`  Threads returned: ${result.length}`);
      console.table(
        result.map((t) => ({
          subject: t.subject.slice(0, 50),
          messages: t.message_count,
          participants: t.participants
            .map((p) => p.email)
            .join(', ')
            .slice(0, 60),
          bodyPreview: t.messages[0]?.message.body_text.slice(0, 80),
        })),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getLabels — label resolution and overview
  // -------------------------------------------------------------------------

  describe('getLabels', () => {
    it('returns grouped label overview with counts', async () => {
      const overview = await toolkit.getLabels();

      expect(overview.system_labels.length).toBeGreaterThan(0);
      expect(overview.summary).toBeDefined();
      expect(overview.summary.total_user_labels).toBeGreaterThanOrEqual(0);

      console.log(`  System labels: ${overview.system_labels.length}`);
      console.log(`  User labels: ${overview.user_labels.length}`);
      console.log(`  Categories: ${overview.categories.length}`);
      console.log(`  Most active: ${overview.summary.most_active}`);

      if (overview.user_labels.length > 0) {
        console.log('\n  User labels:');
        console.table(
          overview.user_labels.slice(0, 10).map((l) => ({
            name: l.name,
            messages: l.messages_total,
            unread: l.messages_unread,
          })),
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // getDrafts — draft listing with transform
  // -------------------------------------------------------------------------

  describe('getDrafts', () => {
    it('returns draft summaries with headers', async () => {
      const result = await toolkit.getDrafts();

      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('drafts');
      expect(result.total).toBeGreaterThanOrEqual(0);

      console.log(`  Total drafts: ${result.total}`);
      if (result.drafts.length > 0) {
        console.table(
          result.drafts.slice(0, 5).map((d) => ({
            draft_id: d.draft_id,
            subject: d.subject?.slice(0, 50),
            to: d.to
              .map((c) => c.email)
              .join(', ')
              .slice(0, 40),
          })),
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // getAccountContext — full account snapshot
  // -------------------------------------------------------------------------

  describe('getAccountContext', () => {
    it('returns complete account context with profile, labels, and filters', async () => {
      const account = await toolkit.getAccountContext();

      expect(account.email).toContain('@');
      expect(account.messages_total).toBeGreaterThan(0);
      expect(account.labels).toBeDefined();
      expect(account.filters).toBeDefined();
      expect(account.vacation).toHaveProperty('enabled');
      expect(account.forwarding).toHaveProperty('enabled');
      expect(account.imap).toHaveProperty('enabled');
      expect(account.pop).toHaveProperty('enabled');

      console.log(`  Email: ${account.email}`);
      console.log(`  Messages: ${account.messages_total}`);
      console.log(`  Threads: ${account.threads_total}`);
      console.log(`  Vacation: ${account.vacation.enabled ? 'ON' : 'off'}`);
      console.log(`  Forwarding: ${account.forwarding.enabled ? account.forwarding.email : 'off'}`);
      console.log(`  IMAP: ${account.imap.enabled ? 'enabled' : 'disabled'}`);
      console.log(`  Send-as aliases: ${account.send_as_aliases.length}`);
      console.log(`  Delegates: ${account.delegates.length}`);
      console.log(
        `  Labels: ${account.labels.system_labels.length} system, ${account.labels.user_labels.length} user`,
      );
      console.log(`  Filters: ${account.filters.total}`);
    });
  });
});
