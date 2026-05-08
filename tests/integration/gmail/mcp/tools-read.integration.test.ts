/**
 * Layer 3 — MCP Read Tools Integration Tests
 *
 * Deep coverage of all 4 read tools (gmail_account, gmail_search, gmail_read,
 * gmail_get_drafts) via InMemoryTransport + Client against the live Gmail API.
 *
 * Tests input schema variations, response structure, edge cases, and error paths.
 * Optionally saves response fixtures: SAVE_FIXTURES=1 npm run test:integration
 *
 * Requires: credentials.json + token.json (OAuth2 configured)
 * Run:      npm run test:integration
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createGmailToolkit } from '../../../../src/gmail/api/index.js';
import { createMcpServer } from '../../../../src/gmail/mcp/server.js';

const HAS_CREDENTIALS = fs.existsSync('credentials.json') && fs.existsSync('token.json');
const SAVE_FIXTURES = process.env.SAVE_FIXTURES !== '0';
const FIXTURE_DIR = path.join(import.meta.dirname, 'fixtures');

/**
 * Extract and parse JSON text from an MCP callTool result.
 * @param result - The MCP callTool response
 * @returns Parsed JSON content
 */
function parseResult(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

/**
 * Optionally save a fixture to disk for debugging and reference.
 * Only writes when SAVE_FIXTURES=1 environment variable is set.
 * @param name - Fixture filename (without extension)
 * @param data - The data to save
 */
function saveFixture(name: string, data: unknown): void {
  if (!SAVE_FIXTURES) return;
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

/**
 * Extract just the structure (keys + types) from a data object for shape assertions.
 * @param obj - The object to extract structure from
 * @param depth - Maximum recursion depth
 * @returns A structure descriptor with types instead of values
 */
function extractShape(obj: unknown, depth = 3): unknown {
  if (depth === 0) return typeof obj;
  if (obj === null) return 'null';
  if (Array.isArray(obj)) {
    return obj.length > 0 ? [extractShape(obj[0], depth - 1)] : '[]';
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = extractShape(value, depth - 1);
    }
    return result;
  }
  return typeof obj;
}

describe.skipIf(!HAS_CREDENTIALS)('tools-read — Live API', () => {
  let client: Client;

  beforeAll(async () => {
    const toolkit = await createGmailToolkit();
    const server = createMcpServer(toolkit);

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: 'tools-read-test', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  // =========================================================================
  // gmail_account
  // =========================================================================

  describe('gmail_account', () => {
    it('returns complete account context with all sections', async () => {
      const result = await client.callTool({ name: 'gmail_account', arguments: {} });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);

      // Profile
      expect(data.email).toContain('@');
      expect(data.messages_total).toBeGreaterThan(0);
      expect(data.threads_total).toBeGreaterThan(0);
      expect(data.history_id).toBeTruthy();

      // Settings sections
      expect(data.vacation).toBeDefined();
      expect(data.forwarding).toBeDefined();
      expect(data.imap).toBeDefined();
      expect(data.pop).toBeDefined();
      expect(data.send_as_aliases).toBeInstanceOf(Array);
      expect(data.delegates).toBeInstanceOf(Array);
      expect(data.forwarding_addresses).toBeInstanceOf(Array);

      // Labels
      const labels = data.labels as Record<string, unknown>;
      expect(labels.system_labels).toBeInstanceOf(Array);
      expect(labels.user_labels).toBeInstanceOf(Array);
      expect(labels.summary).toBeDefined();

      // Filters
      const filters = data.filters as Record<string, unknown>;
      expect(filters.total).toBeGreaterThanOrEqual(0);
      expect(filters.filters).toBeInstanceOf(Array);

      // Structure snapshot — catches shape changes across runs
      const shape = extractShape(data, 2);
      expect(shape).toMatchSnapshot('gmail_account response shape');

      saveFixture('gmail_account', data);

      console.log(`  Email: ${String(data.email)}`);
      console.log(
        `  Messages: ${String(data.messages_total)} | Threads: ${String(data.threads_total)}`,
      );
      console.log(
        `  Labels: ${(labels.system_labels as unknown[]).length} system, ${(labels.user_labels as unknown[]).length} user`,
      );
      console.log(`  Filters: ${String(filters.total)}`);
    });
  });

  // =========================================================================
  // gmail_search
  // =========================================================================

  describe('gmail_search', () => {
    it('searches with raw query string', async () => {
      const result = await client.callTool({
        name: 'gmail_search',
        arguments: { query: 'newer_than:7d' },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      expect(data.total_messages).toBeGreaterThanOrEqual(0);
      expect(data.total_threads).toBeGreaterThanOrEqual(0);
      expect(data.threads).toBeInstanceOf(Array);
      expect(data.summary).toBeDefined();

      const summary = data.summary as Record<string, unknown>;
      expect(summary.senders).toBeInstanceOf(Array);
      expect(summary.labels).toBeDefined();
      expect(summary.thread_depth).toBeDefined();

      // Shape snapshot
      if ((data.threads as unknown[]).length > 0) {
        const shape = extractShape(data, 3);
        expect(shape).toMatchSnapshot('gmail_search response shape');
      }

      saveFixture('gmail_search_raw_query', data);

      console.log(`  Query: newer_than:7d`);
      console.log(
        `  Messages: ${String(data.total_messages)} | Threads: ${String(data.total_threads)}`,
      );
      console.log(`  Unread: ${String(summary.unread_count)}`);
    });

    it('searches with structured from filter', async () => {
      const result = await client.callTool({
        name: 'gmail_search',
        arguments: { from: 'noreply', query: 'newer_than:14d' },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      expect(data.total_messages).toBeGreaterThanOrEqual(0);

      console.log(`  From "noreply" (14d): ${String(data.total_messages)} messages`);
    });

    it('searches with structured date range', async () => {
      const result = await client.callTool({
        name: 'gmail_search',
        arguments: { after: '2026-04-01', before: '2026-04-15' },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      expect(data.total_messages).toBeGreaterThanOrEqual(0);

      console.log(`  Date range 2026-04-01 to 2026-04-15: ${String(data.total_messages)} messages`);
    });

    it('searches with is:unread status filter', async () => {
      const result = await client.callTool({
        name: 'gmail_search',
        arguments: { is: 'unread', query: 'newer_than:7d' },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      expect(data.total_messages).toBeGreaterThanOrEqual(0);

      // When filtering for unread, all matched messages should be unread
      const summary = data.summary as Record<string, unknown>;
      if ((data.total_messages as number) > 0) {
        expect(summary.unread_count).toBe(data.total_messages);
      }

      console.log(`  Unread (7d): ${String(data.total_messages)} messages`);
    });

    it('searches with label filter', async () => {
      // First get a user label to filter by
      const accountResult = await client.callTool({ name: 'gmail_account', arguments: {} });
      const account = parseResult(accountResult);
      const labels = account.labels as Record<string, unknown>;
      const userLabels = labels.user_labels as Record<string, unknown>[];

      if (userLabels.length === 0) {
        console.log('  No user labels to filter by');
        return;
      }

      const labelName = String(userLabels[0].name);
      const result = await client.callTool({
        name: 'gmail_search',
        arguments: { labels: [labelName], query: 'newer_than:30d' },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      console.log(`  Label "${labelName}" (30d): ${String(data.total_messages)} messages`);
    });

    it('searches with combined structured criteria + raw query', async () => {
      const result = await client.callTool({
        name: 'gmail_search',
        arguments: {
          from: 'google',
          is: 'unread',
          query: 'newer_than:30d',
        },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      console.log(`  From "google" + unread (30d): ${String(data.total_messages)} messages`);
    });

    it('returns empty results for impossible query', async () => {
      const result = await client.callTool({
        name: 'gmail_search',
        arguments: { query: 'from:zzzznonexistent99999@impossible.invalid' },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      expect(data.total_messages).toBe(0);
      expect(data.total_threads).toBe(0);
      expect(data.threads).toEqual([]);

      console.log('  Impossible query returned 0 results (correct)');
    });

    it('returns enriched summary analytics', async () => {
      const result = await client.callTool({
        name: 'gmail_search',
        arguments: { query: 'newer_than:14d' },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      const summary = data.summary as Record<string, unknown>;

      // Enriched fields should be present when there are results
      if ((data.total_messages as number) > 0) {
        expect(summary.domains).toBeInstanceOf(Array);
        expect(summary.size_stats).toBeDefined();
        expect(summary.date_histogram).toBeInstanceOf(Array);

        saveFixture('gmail_search_enriched_summary', summary);

        const domains = summary.domains as Record<string, unknown>[];
        console.log(
          `  Top domains: ${domains
            .slice(0, 3)
            .map((d) => String(d.domain))
            .join(', ')}`,
        );
      }
    });
  });

  // =========================================================================
  // gmail_read
  // =========================================================================

  describe('gmail_read', () => {
    let recentMessageIds: string[] = [];

    beforeAll(async () => {
      // Fetch a few message IDs for read tests
      const searchResult = await client.callTool({
        name: 'gmail_search',
        arguments: { query: 'newer_than:7d' },
      });
      const searchData = parseResult(searchResult);
      const threads = searchData.threads as Record<string, unknown>[];
      recentMessageIds = threads
        .flatMap((t) => (t.matched_messages as Record<string, unknown>[]).map((m) => String(m.id)))
        .slice(0, 5);
    });

    it('reads a single message with full body text', async () => {
      if (recentMessageIds.length === 0) return;

      const result = await client.callTool({
        name: 'gmail_read',
        arguments: { message_ids: [recentMessageIds[0]] },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result) as unknown as Record<string, unknown>[];
      expect(data).toBeInstanceOf(Array);
      expect(data.length).toBe(1);

      const thread = data[0];
      expect(thread.subject).toBeDefined();
      expect(thread.participants).toBeInstanceOf(Array);
      expect(thread.message_count).toBeGreaterThan(0);
      expect(thread.date_range).toBeDefined();

      const messages = thread.messages as Record<string, unknown>[];
      const msg = messages[0].message as Record<string, unknown>;
      expect(msg.id).toBe(recentMessageIds[0]);
      expect(msg.from).toBeDefined();
      expect(msg.to).toBeInstanceOf(Array);
      expect(msg.body_text).toBeDefined();
      expect(typeof msg.body_text).toBe('string');
      expect(msg.web_url).toContain('mail.google.com');
      expect(msg.labels).toBeInstanceOf(Array);

      // Shape snapshot
      const shape = extractShape(data[0], 3);
      expect(shape).toMatchSnapshot('gmail_read thread shape');

      saveFixture('gmail_read_single', data);

      console.log(`  Subject: ${String(thread.subject)}`);
      console.log(`  Body length: ${(msg.body_text as string).length} chars`);
    });

    it('reads multiple messages and groups by thread', async () => {
      if (recentMessageIds.length < 2) return;

      const result = await client.callTool({
        name: 'gmail_read',
        arguments: { message_ids: recentMessageIds.slice(0, 3) },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result) as unknown as Record<string, unknown>[];
      expect(data.length).toBeGreaterThan(0);

      // Each thread has messages nested
      for (const thread of data) {
        expect(thread.id).toBeTruthy();
        expect(thread.subject).toBeDefined();
        expect(thread.messages).toBeInstanceOf(Array);
        expect((thread.messages as unknown[]).length).toBeGreaterThan(0);
      }

      console.log(
        `  Read ${recentMessageIds.slice(0, 3).length} messages → ${data.length} threads`,
      );
    });

    it('reads with include_html flag', async () => {
      if (recentMessageIds.length === 0) return;

      const result = await client.callTool({
        name: 'gmail_read',
        arguments: { message_ids: [recentMessageIds[0]], include_html: true },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result) as unknown as Record<string, unknown>[];
      const msg = (data[0].messages as Record<string, unknown>[])[0].message as Record<
        string,
        unknown
      >;

      // body_html should be present (may be null for plain-text emails)
      expect('body_html' in msg).toBe(true);

      const htmlLen = msg.body_html != null ? (msg.body_html as string).length : 0;
      console.log(
        `  include_html=true → body_html: ${htmlLen > 0 ? `${htmlLen} chars` : 'null (plain-text email)'}`,
      );
    });

    it('returns error for invalid message ID', async () => {
      const result = await client.callTool({
        name: 'gmail_read',
        arguments: { message_ids: ['invalid_id_xyz'] },
      });

      expect(result.isError).toBe(true);
      const error = parseResult(result);
      expect(error.code).toBeDefined();
      expect(error.message).toBeDefined();
      expect(error.operation).toBeDefined();

      console.log(
        `  Error: code=${String(error.code)}, message=${String(error.message).slice(0, 60)}`,
      );
    });
  });

  // =========================================================================
  // gmail_get_drafts
  // =========================================================================

  describe('gmail_get_drafts', () => {
    it('lists drafts with metadata', async () => {
      const result = await client.callTool({
        name: 'gmail_get_drafts',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      expect(data.total).toBeGreaterThanOrEqual(0);
      expect(data.drafts).toBeInstanceOf(Array);

      const drafts = data.drafts as Record<string, unknown>[];
      if (drafts.length > 0) {
        const draft = drafts[0];
        expect(draft.draft_id).toBeTruthy();
        expect(draft.to).toBeInstanceOf(Array);
        expect(draft.snippet).toBeDefined();

        // Shape snapshot
        const shape = extractShape(data, 3);
        expect(shape).toMatchSnapshot('gmail_get_drafts response shape');
      }

      saveFixture('gmail_get_drafts', data);
      console.log(`  Total drafts: ${String(data.total)}`);
    });

    it('lists drafts with body text included', async () => {
      const result = await client.callTool({
        name: 'gmail_get_drafts',
        arguments: { include_body: true },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      const drafts = data.drafts as Record<string, unknown>[];

      if (drafts.length > 0) {
        // body_text should be present when include_body=true
        const draft = drafts[0];
        expect('body_text' in draft).toBe(true);

        const bodyLen = draft.body_text != null ? (draft.body_text as string).length : 0;
        console.log(
          `  include_body=true → body_text: ${bodyLen > 0 ? `${bodyLen} chars` : 'null (empty draft)'}`,
        );
      } else {
        console.log('  No drafts to test include_body');
      }
    });

    it('filters drafts with query', async () => {
      const result = await client.callTool({
        name: 'gmail_get_drafts',
        arguments: { query: 'subject:nonexistent_impossible_draft_xyz' },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      expect(data.total).toBe(0);
      expect(data.drafts).toEqual([]);

      console.log('  Filtered drafts with impossible query: 0 results (correct)');
    });
  });
});
