/**
 * Layer 1 — Client Integration Tests
 *
 * Exercises L1 client methods against the live Gmail API.
 * Validates that Zod schemas match real responses, connection pooling works,
 * and BatchResult collection handles real concurrent calls.
 *
 * Requires: credentials.json + token.json (OAuth2 configured)
 * Run:      npm run test:integration
 */

import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createGmailContext, type GmailContext } from '../../../src/api/context.js';

const HAS_CREDENTIALS = fs.existsSync('credentials.json') && fs.existsSync('token.json');

describe.skipIf(!HAS_CREDENTIALS)('L1 Client — Live API', () => {
  let ctx: GmailContext;

  beforeAll(async () => {
    ctx = await createGmailContext();
  });

  afterAll(() => {
    ctx.client.destroy?.();
  });

  // -------------------------------------------------------------------------
  // Settings / Profile
  // -------------------------------------------------------------------------

  describe('settings', () => {
    it('getProfile returns a valid email and message count', async () => {
      const profile = await ctx.client.settings.getProfile();

      expect(profile.emailAddress).toContain('@');
      expect(profile.messagesTotal).toBeGreaterThan(0);
      expect(profile.historyId).toBeTruthy();

      console.table({
        email: profile.emailAddress,
        messages: profile.messagesTotal,
        threads: profile.threadsTotal,
        historyId: profile.historyId,
      });
    });

    it('getVacation returns vacation settings', async () => {
      const vacation = await ctx.client.settings.getVacation();
      expect(vacation).toHaveProperty('enableAutoReply');
    });
  });

  // -------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------

  describe('labels', () => {
    it('list returns system labels (Zod validated)', async () => {
      const labels = await ctx.client.labels.list();
      const names = labels.map((l) => l.name);

      expect(labels.length).toBeGreaterThan(0);
      expect(names).toContain('INBOX');
      expect(names).toContain('SENT');

      console.table(
        labels.slice(0, 10).map((l) => ({
          id: l.id,
          name: l.name,
          type: l.type,
        })),
      );
    });

    it('batchGet returns labels with counts (Zod validated)', async () => {
      const labels = await ctx.client.labels.list();
      const userLabels = labels.filter((l) => l.type === 'user').slice(0, 3);

      if (userLabels.length === 0) {
        console.log('  No user labels to test batchGet');
        return;
      }

      const detailed = await ctx.client.labels.batchGet(userLabels.map((l) => l.id ?? ''));

      expect(detailed.length).toBe(userLabels.length);
      for (const label of detailed) {
        expect(label.id).toBeTruthy();
        expect(label.name).toBeTruthy();
        expect(label.messagesTotal).toBeGreaterThanOrEqual(0);
      }

      console.table(
        detailed.map((l) => ({
          name: l.name,
          messages: l.messagesTotal,
          unread: l.messagesUnread,
        })),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  describe('messages', () => {
    let messageIds: string[] = [];

    beforeAll(async () => {
      const { messages } = await ctx.client.messages.list({ maxResults: 5 });
      messageIds = messages.map((m) => m.id);
    });

    it('list returns message IDs with pagination metadata', async () => {
      const result = await ctx.client.messages.list({ maxResults: 3 });

      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages.length).toBeLessThanOrEqual(3);
      expect(result.resultSizeEstimate).toBeGreaterThan(0);

      for (const msg of result.messages) {
        expect(msg.id).toBeTruthy();
        expect(msg.threadId).toBeTruthy();
      }

      console.table(result.messages);
    });

    it('batchGet returns full messages with headers (Zod validated)', async () => {
      const fetched = await ctx.client.messages.batchGet(messageIds.slice(0, 3), 'metadata', [
        'From',
        'Subject',
        'Date',
      ]);

      expect(fetched.length).toBe(Math.min(3, messageIds.length));
      for (const msg of fetched) {
        expect(msg.id).toBeTruthy();
        expect(msg.payload?.headers?.length).toBeGreaterThan(0);
      }

      console.table(
        fetched.map((msg) => {
          const h = new Map(msg.payload?.headers?.map((hdr) => [hdr.name, hdr.value] as const));
          return {
            id: msg.id,
            subject: h.get('Subject')?.slice(0, 60),
            from: h.get('From')?.slice(0, 40),
            date: h.get('Date'),
          };
        }),
      );
    });

    it('get returns a single message with payload (Zod validated)', async () => {
      if (messageIds.length === 0) return;

      const msg = await ctx.client.messages.get(messageIds[0], 'metadata', ['Subject']);

      expect(msg.id).toBe(messageIds[0]);
      expect(msg.labelIds).toBeDefined();
      expect(msg.payload?.headers).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Threads
  // -------------------------------------------------------------------------

  describe('threads', () => {
    it('list returns thread IDs with snippets', async () => {
      const result = await ctx.client.threads.list({ maxResults: 3 });

      expect(result.threads.length).toBeGreaterThan(0);
      for (const thread of result.threads) {
        expect(thread.id).toBeTruthy();
      }

      console.table(
        result.threads.map((t) => ({
          id: t.id,
          snippet: t.snippet.slice(0, 60),
        })),
      );
    });

    it('batchGet returns threads with nested messages (Zod validated)', async () => {
      const { threads } = await ctx.client.threads.list({ maxResults: 3 });
      const threadIds = threads.map((t) => t.id);

      const fetched = await ctx.client.threads.batchGet(threadIds, 'minimal');

      expect(fetched.length).toBe(threadIds.length);
      for (const thread of fetched) {
        expect(thread.id).toBeTruthy();
        expect(thread.messages).toBeDefined();
        expect(thread.messages?.length).toBeGreaterThan(0);
      }

      console.table(
        fetched.map((t) => ({
          id: t.id,
          messageCount: t.messages?.length,
        })),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Drafts
  // -------------------------------------------------------------------------

  describe('drafts', () => {
    it('list returns draft summaries', async () => {
      const result = await ctx.client.drafts.list({ maxResults: 3 });

      // Drafts may be empty — that's valid
      expect(result.drafts).toBeDefined();
      expect(result.resultSizeEstimate).toBeGreaterThanOrEqual(0);

      if (result.drafts.length > 0) {
        console.table(result.drafts);
      } else {
        console.log('  No drafts found (empty is valid)');
      }
    });
  });

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  describe('history', () => {
    it('list returns history events from current historyId', async () => {
      const profile = await ctx.client.settings.getProfile();
      const historyId = profile.historyId ?? '';

      const result = await ctx.client.history.list({
        startHistoryId: historyId,
      });

      // Starting from the current historyId usually returns empty — that's fine
      expect(result.historyId).toBeTruthy();
      console.log(`  Current historyId: ${result.historyId}, events: ${result.history.length}`);
    });
  });
});
