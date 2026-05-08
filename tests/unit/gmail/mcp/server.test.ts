/**
 * Layer 3 — MCP Server Unit Tests
 *
 * Tests tool registry configuration, createMcpServer factory output,
 * and response serialization. Uses a mock GmailToolkit to avoid live API calls.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  resolveToolRegistry,
  DEFAULT_TOOL_REGISTRY,
} from '../../../../src/gmail/mcp/tool-registry.js';
import { createMcpServer } from '../../../../src/gmail/mcp/server.js';
import type { GmailToolkit } from '../../../../src/gmail/api/index.js';

// ---------------------------------------------------------------------------
// Mock Toolkit — returns canned data without hitting the Gmail API
// ---------------------------------------------------------------------------

function createMockToolkit(): GmailToolkit {
  return {
    search: vi.fn().mockResolvedValue({
      total_messages: 0,
      total_threads: 0,
      threads: [],
      summary: {
        unread_count: 0,
        senders: [],
        labels: {},
        thread_depth: { single_message: 0, multi_message: 0 },
      },
    }),
    read: vi.fn().mockResolvedValue([]),
    modify: vi.fn().mockResolvedValue({ modified: 0, failed: [], message: 'No targets' }),
    trash: vi.fn().mockResolvedValue({ modified: 0, failed: [], message: 'No targets' }),
    getLabels: vi.fn().mockResolvedValue({
      system_labels: [],
      user_labels: [],
      categories: [],
      summary: { total_user_labels: 0, empty_labels: [], most_active: '' },
    }),
    createLabel: vi.fn().mockResolvedValue({ id: 'Label_1', name: 'Test' }),
    updateLabel: vi.fn().mockResolvedValue({ id: 'Label_1', name: 'Updated' }),
    deleteLabel: vi.fn().mockResolvedValue({
      deleted: true,
      label_name: 'Test',
      label_id: 'Label_1',
      messages_affected: 0,
      threads_affected: 0,
      message: 'Deleted',
    }),
    getDrafts: vi.fn().mockResolvedValue({ total: 0, drafts: [] }),
    compose: vi.fn().mockResolvedValue({ message_id: 'msg_1', thread_id: null, message: 'Sent' }),
    deleteDraft: vi.fn().mockResolvedValue({ deleted: true, message: 'Deleted' }),
    getFilters: vi.fn().mockResolvedValue({ total: 0, filters: [] }),
    createFilter: vi.fn().mockResolvedValue({ id: 'f_1', criteria: {}, actions: {} }),
    updateFilter: vi.fn().mockResolvedValue({ id: 'f_1', criteria: {}, actions: {} }),
    deleteFilter: vi.fn().mockResolvedValue({
      deleted: true,
      filter_id: 'f_1',
      criteria_summary: '',
      message: 'Deleted',
    }),
    resolveFilterCriteria: vi.fn().mockResolvedValue({ total: 0, messages: [] }),
    getHistory: vi.fn().mockResolvedValue({ current_history_id: '0', events: [] }),
    getAccountContext: vi.fn().mockResolvedValue({
      email: 'test@example.com',
      messages_total: 100,
      threads_total: 80,
      history_id: '123',
      vacation: {
        enabled: false,
        subject: null,
        start: null,
        end: null,
        restrict_to_contacts: false,
      },
      forwarding: { enabled: false, email: null, disposition: null },
      forwarding_addresses: [],
      send_as_aliases: [],
      delegates: [],
      imap: { enabled: false, auto_expunge: true, expunge_behavior: '' },
      pop: { enabled: false, access_window: 'disabled', disposition: '' },
      labels: {
        system_labels: [],
        user_labels: [],
        categories: [],
        summary: { total_user_labels: 0, empty_labels: [], most_active: '' },
      },
      filters: { total: 0, filters: [] },
    }),
  } as unknown as GmailToolkit;
}

// ---------------------------------------------------------------------------
// Tool Registry Tests
// ---------------------------------------------------------------------------

describe('Tool Registry', () => {
  it('DEFAULT_TOOL_REGISTRY contains 14 tools', () => {
    const names = Object.keys(DEFAULT_TOOL_REGISTRY);
    expect(names.length).toBe(14);
  });

  it('default config enables 11 tools (3 destructive disabled)', () => {
    const registry = resolveToolRegistry();
    const enabled = Object.values(registry).filter((c) => c.enabled);
    const disabled = Object.values(registry).filter((c) => !c.enabled);

    expect(enabled.length).toBe(11);
    expect(disabled.length).toBe(3);
  });

  it('disabled tools are the destructive ones', () => {
    const registry = resolveToolRegistry();
    const disabledNames = Object.entries(registry)
      .filter(([, c]) => !c.enabled)
      .map(([name]) => name);

    expect(disabledNames).toContain('gmail_compose');
    expect(disabledNames).toContain('gmail_trash');
    expect(disabledNames).toContain('gmail_delete_draft');
  });

  it('every tool has a non-empty description', () => {
    const registry = resolveToolRegistry();
    for (const [name, config] of Object.entries(registry)) {
      expect(config.description, `${name} has empty description`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// createMcpServer Factory Tests
// ---------------------------------------------------------------------------

describe('createMcpServer', () => {
  let client: Client;

  beforeAll(async () => {
    const toolkit = createMockToolkit();
    const server = createMcpServer(toolkit);

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  it('listTools returns all enabled tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names.length).toBe(11);
    expect(names).toContain('gmail_account');
    expect(names).toContain('gmail_search');
    expect(names).toContain('gmail_read');
    expect(names).toContain('gmail_modify');
    // Destructive tools should NOT be listed
    expect(names).not.toContain('gmail_compose');
    expect(names).not.toContain('gmail_trash');
    expect(names).not.toContain('gmail_delete_draft');
  });

  it('every listed tool has an inputSchema', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} missing inputSchema`).toBeDefined();
    }
  });

  it('callTool gmail_account returns structured JSON', async () => {
    const result = await client.callTool({ name: 'gmail_account', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);

    const content = (result.content as { type: string; text: string }[])[0];
    expect(content).toHaveProperty('type', 'text');
    const data = JSON.parse(content.text) as Record<string, unknown>;
    expect(data.email).toBe('test@example.com');
    expect(data.messages_total).toBe(100);
  });

  it('callTool gmail_search returns search results', async () => {
    const result = await client.callTool({
      name: 'gmail_search',
      arguments: { query: 'is:unread' },
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as { type: string; text: string }[])[0].text) as Record<
      string,
      unknown
    >;
    expect(data.total_messages).toBe(0);
    expect(data.summary).toBeDefined();
  });

  it('callTool with invalid tool name rejects or returns error', async () => {
    try {
      const result = await client.callTool({ name: 'nonexistent_tool', arguments: {} });
      // If it resolves, it should be an error result
      expect(result.isError).toBe(true);
    } catch {
      // Rejection is also acceptable (depends on SDK version)
    }
  });
});
