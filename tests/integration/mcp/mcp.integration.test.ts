/**
 * Layer 3 — MCP Server Integration Tests
 *
 * Exercises MCP tools via InMemoryTransport + Client against the live Gmail API.
 * Validates the full L3 → L2 → L1 → API round-trip through the MCP protocol:
 * JSON-RPC serialization, tool routing, input validation, response formatting.
 *
 * Requires: credentials.json + token.json (OAuth2 configured)
 * Run:      npm run test:integration
 */

import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createGmailToolkit } from '../../../src/api/index.js';
import { createMcpServer } from '../../../src/mcp/server.js';

const HAS_CREDENTIALS = fs.existsSync('credentials.json') && fs.existsSync('token.json');

/**
 * Extract and parse JSON text from an MCP callTool result.
 * @param result - The MCP callTool response to parse
 * @returns The parsed JSON content as a record
 */
function parseResult(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe.skipIf(!HAS_CREDENTIALS)('L3 MCP Server — Live API', () => {
  let client: Client;

  beforeAll(async () => {
    const toolkit = await createGmailToolkit();
    const server = createMcpServer(toolkit);

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: 'integration-test', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  // -------------------------------------------------------------------------
  // Tool Discovery
  // -------------------------------------------------------------------------

  describe('tool discovery', () => {
    it('listTools returns enabled tools with schemas', async () => {
      const { tools } = await client.listTools();

      expect(tools.length).toBe(11);
      for (const tool of tools) {
        expect(tool.name).toMatch(/^gmail_/);
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
      }

      console.table(tools.map((t) => ({ name: t.name, description: t.description?.slice(0, 60) })));
    });
  });

  // -------------------------------------------------------------------------
  // Read Tools
  // -------------------------------------------------------------------------

  describe('gmail_account', () => {
    it('returns full account context via MCP protocol', async () => {
      const result = await client.callTool({ name: 'gmail_account', arguments: {} });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      expect(data.email).toContain('@');
      expect(data.messages_total).toBeGreaterThan(0);
      expect(data.labels).toBeDefined();
      expect(data.filters).toBeDefined();

      console.log(`  Email: ${String(data.email)}`);
      console.log(`  Messages: ${String(data.messages_total)}`);
    });
  });

  describe('gmail_search', () => {
    it('returns search results with summary via MCP protocol', async () => {
      const result = await client.callTool({
        name: 'gmail_search',
        arguments: { query: 'newer_than:3d' },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      expect(data.total_messages).toBeGreaterThanOrEqual(0);
      expect(data.summary).toBeDefined();
      expect(data.threads).toBeInstanceOf(Array);

      console.log(`  Total messages: ${String(data.total_messages)}`);
      console.log(`  Total threads: ${String(data.total_threads)}`);
    });

    it('supports structured criteria (from, subject)', async () => {
      const result = await client.callTool({
        name: 'gmail_search',
        arguments: { from: 'noreply', query: 'newer_than:7d' },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      expect(data.total_messages).toBeGreaterThanOrEqual(0);
      console.log(`  Messages from "noreply": ${String(data.total_messages)}`);
    });
  });

  describe('gmail_read', () => {
    it('returns full messages with body text via MCP protocol', async () => {
      const searchResult = await client.callTool({
        name: 'gmail_search',
        arguments: { query: 'newer_than:3d' },
      });
      const searchData = parseResult(searchResult);
      const threads = searchData.threads as Record<string, unknown>[] | undefined;

      if (threads == null || threads.length === 0) {
        console.log('  No recent messages to read');
        return;
      }

      const matchedMessages = threads[0].matched_messages as Record<string, unknown>[];
      const messageId = String(matchedMessages[0].id);

      const result = await client.callTool({
        name: 'gmail_read',
        arguments: { message_ids: [messageId] },
      });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result) as unknown as Record<string, unknown>[];
      expect(data).toBeInstanceOf(Array);
      expect(data.length).toBeGreaterThan(0);

      const thread = data[0];
      expect(thread.subject).toBeDefined();
      console.log(`  Subject: ${String(thread.subject)}`);
    });
  });

  describe('gmail_get_drafts', () => {
    it('returns draft listing via MCP protocol', async () => {
      const result = await client.callTool({ name: 'gmail_get_drafts', arguments: {} });
      expect(result.isError).toBeFalsy();

      const data = parseResult(result);
      expect(data.total).toBeGreaterThanOrEqual(0);
      expect(data.drafts).toBeInstanceOf(Array);
      console.log(`  Total drafts: ${String(data.total)}`);
    });
  });

  // -------------------------------------------------------------------------
  // Error Handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('returns structured GmailToolkitError for invalid message ID', async () => {
      const result = await client.callTool({
        name: 'gmail_read',
        arguments: { message_ids: ['invalid_id_that_does_not_exist'] },
      });

      expect(result.isError).toBe(true);
      const data = parseResult(result);
      expect(data.code).toBeDefined();
      expect(data.message).toBeDefined();
      expect(data.operation).toBeDefined();
      expect(data.retryable).toBeDefined();

      console.log(`  Error code: ${String(data.code)}`);
      console.log(`  Message: ${String(data.message).slice(0, 80)}`);
    });
  });
});
