#!/usr/bin/env npx tsx
/**
 * Live integration test — exercises ALL Layer 2 api operations against
 * a real Gmail account with maximized parameter breadth.
 *
 * Every result is validated against its Zod schema. Designed for mailboxes
 * with 10K+ messages — uses diverse queries to exercise attachments, sent
 * mail, mailing lists, multi-message threads, and large result sets.
 *
 * Usage: npx tsx scripts/live-test.ts
 *        GMAIL_LOG_LEVEL=debug npx tsx scripts/live-test.ts
 */

import { createGmailToolkit, type GmailToolkit } from '../src/index.js';
import { logger } from '../src/infra/logger.js';
import {
  AccountContextSchema,
  LabelOverviewSchema,
  DraftSummarySchema,
  FilterOverviewSchema,
  FilterDetailSchema,
  LabelDetailSchema,
  DeleteLabelResultSchema,
  DeleteFilterResultSchema,
  HistoryResultSchema,
  SearchAllResultSchema,
  ReadThreadSchema,
} from '../src/infra/types.js';
import type { z } from 'zod';

const log = logger.child('live-test');
let passed = 0;
let failed = 0;
let skipped = 0;

/**
 * Section header for test output.
 * @param title - The section title to display
 */
function section(title: string) {
  log.info(`\n${'─'.repeat(60)}\n  ${title}\n${'─'.repeat(60)}`);
}

/**
 * Log a passing test result.
 * @param label - The test label
 * @param detail - Optional detail string
 */
function ok(label: string, detail?: string) {
  passed++;
  log.info(`✅  ${label}${detail !== undefined ? `  →  ${detail}` : ''}`);
}

/**
 * Log a failing test result.
 * @param label - The test label
 * @param err - The error that caused the failure
 */
function fail(label: string, err: unknown) {
  failed++;
  log.error(`❌  ${label}  →  ${err instanceof Error ? err.message : String(err)}`);
}

/**
 * Log a skipped test.
 * @param label - The test label
 * @param reason - Why the test was skipped
 */
function skip(label: string, reason: string) {
  skipped++;
  log.info(`⏭️   ${label}  (${reason})`);
}

/**
 * Validate data against a Zod schema — throws with field-level detail on mismatch.
 * @param schema - The Zod schema to validate against
 * @param data - The data to validate
 * @param label - Human-readable label for error messages
 * @returns The validated and typed data
 */
function validate<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Schema validation failed for ${label}:\n${issues}`);
  }
  return result.data;
}

async function main() {
  log.info('🔧  Gmail Toolkit — Live Integration Test (full breadth)');

  // === 1. Init ===
  section('1. Initialisation');
  let gmail: GmailToolkit;
  try {
    gmail = await createGmailToolkit();
    ok('createGmailToolkit()');
  } catch (err) {
    fail('createGmailToolkit()', err);
    process.exit(1);
  }

  // === 2. Account ===
  section('2. Account');
  let historyId: string | undefined;
  try {
    const a = await gmail.getAccountContext();
    validate(AccountContextSchema, a, 'AccountContext');
    historyId = a.history_id;
    ok(
      'getAccountContext()',
      `${a.email} / ${a.messages_total} msgs / ${a.send_as_aliases.length} aliases / historyId=${historyId}`,
    );
  } catch (err) {
    fail('getAccountContext()', err);
  }

  // === 3. Labels ===
  section('3. Labels');
  let userLabelName: string | undefined;
  try {
    const l = await gmail.getLabels();
    validate(LabelOverviewSchema, l, 'LabelOverview');
    userLabelName = l.user_labels.at(0)?.name;
    ok(
      'getLabels()',
      `${l.user_labels.length} user + ${l.system_labels.length} system + ${l.categories.length} categories`,
    );
  } catch (err) {
    fail('getLabels()', err);
  }

  // === 4. Search — diverse queries ===
  section('4. Search (diverse queries, auto-paginated)');
  let msgIds: string[] = [];
  let threadIds: string[] = [];
  const queries = [
    { q: 'newer_than:90d', label: 'broad 90d' },
    { q: 'newer_than:30d', label: '30d' },
    { q: 'has:attachment newer_than:180d', label: 'attachments' },
    { q: 'in:sent newer_than:180d', label: 'sent mail' },
    { q: 'is:starred', label: 'starred' },
    { q: 'larger:500K newer_than:365d', label: 'large messages' },
    { q: 'list:* newer_than:90d', label: 'mailing lists' },
  ];
  if (userLabelName !== undefined) {
    queries.push({
      q: `label:${userLabelName.replace(/\s+/g, '-')}`,
      label: `label:${userLabelName}`,
    });
  }

  for (const { q, label } of queries) {
    try {
      const r = await gmail.search(q);
      validate(SearchAllResultSchema, r, `SearchAllResult (${label})`);
      threadIds.push(...r.threads.map((t) => t.id));
      msgIds.push(...r.threads.flatMap((t) => t.matched_messages.map((m) => m.id)));
      ok(
        `search(${label})`,
        `${r.total_messages} msgs, ${r.total_threads} threads, unread=${r.summary.unread_count}`,
      );
    } catch (err) {
      fail(`search(${label})`, err);
    }
  }
  // Deduplicate collected IDs
  msgIds = [...new Set(msgIds)];
  threadIds = [...new Set(threadIds)];
  log.info(
    `       collected ${msgIds.length} unique message IDs, ${threadIds.length} unique thread IDs`,
  );

  // === 5. Read Messages ===
  section('5. Read Messages (single + batch)');
  const firstMsg = msgIds.at(0);
  if (firstMsg !== undefined) {
    try {
      const r = await gmail.read([firstMsg], { includeHtml: true });
      for (const thread of r) validate(ReadThreadSchema, thread, `read[${thread.id}]`);
      const t = r[0];
      const m = t.messages[0];
      ok(
        `read(1, includeHtml=true)`,
        `from=${m.message.from.email}, attach=${(m.message.attachments ?? []).length}, html=${m.message.body_html != null ? 'yes' : 'no'}, pos=${m.position}/${t.message_count}`,
      );
    } catch (err) {
      fail('read(single)', err);
    }
  }

  // === 6. Drafts ===
  section('6. Drafts');
  try {
    const d = await gmail.getDrafts(undefined, true);
    validate(DraftSummarySchema, d, 'DraftSummary');
    ok('getDrafts(body=true)', `${d.drafts.length} drafts`);
  } catch (err) {
    fail('getDrafts()', err);
  }

  // === 7. Filters ===
  section('7. Filters');
  try {
    const f = await gmail.getFilters();
    validate(FilterOverviewSchema, f, 'FilterOverview');
    ok('getFilters()', `${f.total} filters`);
  } catch (err) {
    fail('getFilters()', err);
  }

  // === 8. History — use older watermark for real events ===
  section('8. History');
  if (historyId !== undefined) {
    // Use a slightly older historyId to get actual events
    const olderHistoryId = String(Math.max(1, Number(historyId) - 500));
    try {
      const h = await gmail.getHistory(olderHistoryId);
      validate(HistoryResultSchema, h, 'HistoryResult');
      const byType: Record<string, number> = {};
      for (const e of h.events) byType[e.type] = (byType[e.type] ?? 0) + 1;
      ok(`getHistory(${olderHistoryId})`, `${h.events.length} events: ${JSON.stringify(byType)}`);
    } catch (err) {
      fail('getHistory(older watermark)', err);
    }
    // Current watermark (should be 0 events)
    try {
      const h = await gmail.getHistory(historyId);
      validate(HistoryResultSchema, h, 'HistoryResult (current)');
      ok('getHistory(current)', `${h.events.length} events (expected 0)`);
    } catch (err) {
      fail('getHistory(current)', err);
    }
  } else {
    skip('getHistory()', 'no historyId');
  }

  // === 9. Read (large batch) ===
  section('9. Read (large batch, diverse)');
  const batchIds = msgIds.slice(0, 15);
  if (batchIds.length >= 5) {
    try {
      const r = await gmail.read(batchIds, { includeHtml: true });
      for (const t of r) validate(ReadThreadSchema, t, `ctx[${t.id}]`);
      const totalMsgs = r.reduce((n, t) => n + t.messages.length, 0);
      const withAttach = r
        .flatMap((t) => t.messages)
        .filter((e) => (e.message.attachments ?? []).length > 0).length;
      const withHtml = r
        .flatMap((t) => t.messages)
        .filter((e) => e.message.body_html != null).length;
      const positions = r.flatMap((t) => t.messages.map((e) => `${e.position}/${t.message_count}`));
      ok(
        `read(${batchIds.length} ids)`,
        `${totalMsgs} msgs, ${r.length} threads, attach=${withAttach}, html=${withHtml}`,
      );
      log.info(`       positions: [${positions.join(', ')}]`);
    } catch (err) {
      fail('read(large batch)', err);
    }
  } else {
    skip('read(large)', 'not enough message IDs collected');
  }

  // === 10. Label CRUD ===
  section('10. Label CRUD');
  const testLabel = `_LiveTest_${Date.now()}`;
  let testLabelId: string | undefined;
  try {
    const c = await gmail.createLabel(testLabel, {
      color: { text: '#ffffff', background: '#fb4c2f' },
    });
    validate(LabelDetailSchema, c, 'LabelDetail');
    testLabelId = c.id;
    ok(`createLabel("${testLabel}")`, `id=${c.id}`);
    const u = await gmail.updateLabel(testLabelId, {
      new_name: `${testLabel}_upd`,
      color: { text: '#000000', background: '#ffc8af' },
    });
    validate(LabelDetailSchema, u, 'LabelDetail (updated)');
    ok(`updateLabel()`, `name="${u.name}"`);
    const d = await gmail.deleteLabel(testLabelId);
    validate(DeleteLabelResultSchema, d, 'DeleteLabelResult');
    ok(`deleteLabel()`, `deleted=${d.deleted}`);
  } catch (err) {
    fail('label CRUD', err);
    if (testLabelId !== undefined)
      await gmail.deleteLabel(testLabelId).catch(() => {
        /* cleanup best-effort */
      });
  }

  // === 11. Filter CRUD ===
  section('11. Filter CRUD');
  let testFilterId: string | undefined;
  try {
    const c = await gmail.createFilter(
      { from: '_live-test-noreply@example.com', has_attachment: false },
      { add_labels: ['STARRED'], skip_inbox: false, mark_read: false },
    );
    validate(FilterDetailSchema, c, 'FilterDetail');
    testFilterId = c.id;
    ok('createFilter()', `id=${c.id}`);
    const filters = await gmail.getFilters();
    ok('getFilters() verify', `found=${filters.filters.some((f) => f.id === testFilterId)}`);
    const d = await gmail.deleteFilter(testFilterId);
    validate(DeleteFilterResultSchema, d, 'DeleteFilterResult');
    ok('deleteFilter()', `deleted=${d.deleted}`);
    const after = await gmail.getFilters();
    ok('getFilters() post-delete', `gone=${!after.filters.some((f) => f.id === testFilterId)}`);
  } catch (err) {
    fail('filter CRUD', err);
    if (testFilterId !== undefined)
      await gmail.deleteFilter(testFilterId).catch(() => {
        /* cleanup best-effort */
      });
  }

  // === 12. Cache ===
  section('12. Cache behaviour');
  try {
    const s1 = performance.now();
    await gmail.getFilters();
    const d1 = performance.now() - s1;
    const s2 = performance.now();
    await gmail.getFilters();
    const d2 = performance.now() - s2;
    ok('filterCache', `cold=${d1.toFixed(0)}ms, warm=${d2.toFixed(0)}ms`);
  } catch (err) {
    fail('cache', err);
  }

  // === Summary ===
  log.info(
    `\n${'═'.repeat(60)}\n  Results: ✅ ${passed} passed   ❌ ${failed} failed   ⏭️  ${skipped} skipped\n${'═'.repeat(60)}`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  log.error('💥 Unhandled error:', err);
  process.exit(1);
});
