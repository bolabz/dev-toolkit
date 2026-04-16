#!/usr/bin/env npx tsx

/**
 * Layer 2 full-breadth stress test — calls every read-side Layer 2 composed
 * operation through GmailToolkit, validates each response against its Zod
 * schema, and writes 100% untruncated output to scripts/debug-layer2-output.json.
 *
 * Two failure modes are tracked independently:
 *   API errors   — the Layer 2 call threw (network, auth, quota, etc.)
 *   Schema errors — call succeeded but the shape failed Zod validation
 *
 * Write/delete operations are intentionally excluded (non-destructive by design).
 *
 * Usage: npx tsx scripts/debug-layer2.ts
 *        GMAIL_LOG_LEVEL=debug npx tsx scripts/debug-layer2.ts
 */

import { createGmailToolkit } from '../src/index.js';
import { logger } from '../src/shared/logger.js';
import {
  AccountContextSchema,
  LabelOverviewSchema,
  DraftSummarySchema,
  FilterOverviewSchema,
  HistoryResultSchema,
  SearchAllResultSchema,
  MessageWithContextSchema,
} from '../src/shared/types.js';
import type { z } from 'zod';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const log = logger.child('debug-layer2');

// ── Counters ──────────────────────────────────────────────────────────────────

let apiErrors = 0;
const schemaFailures: string[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Wrap a single Layer 2 call so a failure doesn't abort the whole run.
 * Stores the result (or `{ __error }`) under `key` in `out`.
 * If a Zod `schema` is supplied the result is validated immediately;
 * any failures are appended to `schemaFailures` without stopping the run.
 * @param out - Accumulator object to write the captured result into
 * @param key - Key used to store the result in `out`
 * @param fn - Async factory that performs the Layer 2 call
 * @param schema - Optional Zod schema to validate the result against
 * @returns The resolved value, or `undefined` on API error
 */
async function capture<T>(
  out: Record<string, unknown>,
  key: string,
  fn: () => Promise<T>,
  schema?: z.ZodType,
): Promise<T | undefined> {
  try {
    const result = await fn();
    // eslint-disable-next-line no-param-reassign
    out[key] = result;

    if (schema != null) {
      const parsed = schema.safeParse(result);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i: z.core.$ZodIssue) => `${i.path.join('.')}: ${i.message}`)
          .join(' | ');
        schemaFailures.push(`${key} — ${issues}`);
        log.warn(`  ⚠  ${key}  →  schema FAIL: ${issues}`);
      } else {
        log.info(`  ✓ ${key}`);
      }
    } else {
      log.info(`  ✓ ${key}`);
    }

    return result;
  } catch (err) {
    apiErrors++;
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-param-reassign
    out[key] = { __error: msg };
    log.warn(`  ✗ ${key}  →  ${msg}`);
    return undefined;
  }
}

async function main() {
  log.info('🔍  Gmail Toolkit — Layer 2 Full Stress Test (capture + schema validation)');

  const gmail = await createGmailToolkit();
  const output: Record<string, unknown> = {};

  // ── 1. Account ──────────────────────────────────────────────────────────────
  log.info('\n── Account ──');
  const account = await capture(
    output,
    'getAccountContext',
    () => gmail.getAccountContext(),
    AccountContextSchema,
  );
  const historyId = account?.history_id;

  // ── 2. Labels ───────────────────────────────────────────────────────────────
  log.info('\n── Labels ──');
  const labelOverview = await capture(
    output,
    'getLabels',
    () => gmail.getLabels(),
    LabelOverviewSchema,
  );
  const firstUserLabel = labelOverview?.user_labels.at(0)?.name;

  // ── 3. Search — parameter breadth ───────────────────────────────────────────
  log.info('\n── Search ──');

  const searchCases: { key: string; q: string }[] = [
    { key: 'search(90d)', q: 'newer_than:90d' },
    { key: 'search(30d)', q: 'newer_than:30d' },
    { key: 'search(attachment)', q: 'has:attachment newer_than:180d' },
    { key: 'search(sent)', q: 'in:sent newer_than:180d' },
    { key: 'search(starred)', q: 'is:starred' },
    { key: 'search(large)', q: 'larger:500K newer_than:365d' },
    { key: 'search(mailingList)', q: 'list:* newer_than:90d' },
    { key: 'search(unread)', q: 'is:unread newer_than:30d' },
  ];
  if (firstUserLabel !== undefined) {
    searchCases.push({
      key: `search(label:${firstUserLabel})`,
      q: `label:${firstUserLabel.replace(/\s+/g, '-')}`,
    });
  }

  const allMsgIds: string[] = [];
  const allThreadIds: string[] = [];

  for (const { key, q } of searchCases) {
    const r = await capture(output, key, () => gmail.search(q), SearchAllResultSchema);
    if (r != null) {
      allThreadIds.push(...r.threads.map((t) => t.id));
      allMsgIds.push(...r.threads.flatMap((t) => t.matched_messages.map((m) => m.id)));
    }
  }

  const uniqueMsgIds = [...new Set(allMsgIds)];
  const uniqueThreadIds = [...new Set(allThreadIds)];
  log.info(`   collected ${uniqueMsgIds.length} msg IDs, ${uniqueThreadIds.length} thread IDs`);

  // ── 4. Read Messages ─────────────────────────────────────────────────────────
  log.info('\n── Read Messages ──');
  const firstId = uniqueMsgIds.at(0);
  const secondId = uniqueMsgIds.at(1);

  if (firstId !== undefined) {
    const msgs = await capture(output, 'read(msg1)', () => gmail.read([firstId]));
    if (msgs != null && msgs.length > 0) {
      const parsed = MessageWithContextSchema.safeParse(msgs[0]);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i: z.core.$ZodIssue) => `${i.path.join('.')}: ${i.message}`)
          .join(' | ');
        schemaFailures.push(`read(msg1) — ${issues}`);
        log.warn(`  ⚠  read(msg1)  →  schema FAIL: ${issues}`);
      }
    }
  }
  if (secondId !== undefined) {
    const msgs = await capture(output, 'read(msg2,includeHtml)', () =>
      gmail.read([secondId], { includeHtml: true }),
    );
    if (msgs != null && msgs.length > 0) {
      const parsed = MessageWithContextSchema.safeParse(msgs[0]);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i: z.core.$ZodIssue) => `${i.path.join('.')}: ${i.message}`)
          .join(' | ');
        schemaFailures.push(`read(msg2) — ${issues}`);
        log.warn(`  ⚠  read(msg2)  →  schema FAIL: ${issues}`);
      }
    }
  }

  // ── 5. Drafts ───────────────────────────────────────────────────────────────
  log.info('\n── Drafts ──');
  await capture(
    output,
    'getDrafts(body=false)',
    () => gmail.getDrafts(undefined, false),
    DraftSummarySchema,
  );
  await capture(
    output,
    'getDrafts(body=true)',
    () => gmail.getDrafts(undefined, true),
    DraftSummarySchema,
  );
  await capture(
    output,
    'getDrafts(query=newer)',
    () => gmail.getDrafts('newer_than:30d', true),
    DraftSummarySchema,
  );

  // ── 6. Filters ──────────────────────────────────────────────────────────────
  log.info('\n── Filters ──');
  await capture(output, 'getFilters', () => gmail.getFilters(), FilterOverviewSchema);

  // ── 7. History ──────────────────────────────────────────────────────────────
  log.info('\n── History ──');
  if (historyId !== undefined) {
    const olderHistoryId = String(Math.max(1, Number(historyId) - 2000));
    await capture(
      output,
      'getHistory(historyId-2000)',
      () => gmail.getHistory(olderHistoryId),
      HistoryResultSchema,
    );
    await capture(
      output,
      'getHistory(current)',
      () => gmail.getHistory(historyId),
      HistoryResultSchema,
    );
  }

  // ── 8. Read (batch) ────────────────────────────────────────────────────────
  log.info('\n── Read (batch, waiting 15 s for quota reset) ──');
  await sleep(15_000);
  const batchSmall = uniqueMsgIds.slice(0, 5);

  if (batchSmall.length > 0) {
    // Capture without a top-level schema — validate each item individually
    // so failures are reported with precise item index paths.
    const msgs = await capture(output, 'read(batch=5)', () =>
      gmail.read(batchSmall, { includeHtml: false }),
    );
    if (msgs != null) {
      let itemsFailed = 0;
      msgs.forEach((item, i) => {
        const parsed = MessageWithContextSchema.safeParse(item);
        if (!parsed.success) {
          itemsFailed++;
          const issues = parsed.error.issues
            .map((iss: z.core.$ZodIssue) => `${iss.path.join('.')}: ${iss.message}`)
            .join(' | ');
          schemaFailures.push(`read(batch)[${i}] — ${issues}`);
          log.warn(`  ⚠  read(batch)[${i}]  →  ${issues}`);
        }
      });
      if (itemsFailed === 0) {
        log.info(`  ✓ read(batch=5) — all ${msgs.length} items valid`);
      }
    }
  }

  // ── Write output ────────────────────────────────────────────────────────────
  const outPath = './scripts/debug-layer2-output.json';
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  const stats = fs.statSync(outPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  const keys = Object.keys(output);
  const apiErrorKeys = keys.filter((k) => {
    const v = output[k];
    return typeof v === 'object' && v !== null && '__error' in v;
  });

  log.info(`\n${'═'.repeat(60)}`);
  log.info(`Output      : ${outPath}  (${sizeMB} MB)`);
  log.info(`Captures    : ${keys.length} total`);
  log.info(
    `API errors  : ${apiErrors}${apiErrorKeys.length > 0 ? `  →  ${apiErrorKeys.join(', ')}` : '  ✅'}`,
  );
  log.info(
    `Schema      : ${schemaFailures.length === 0 ? '✅ all valid' : `❌ ${schemaFailures.length} failure(s)`}`,
  );
  if (schemaFailures.length > 0) {
    for (const f of schemaFailures) log.warn(`  ⚠  ${f}`);
  }
  log.info('═'.repeat(60));

  if (apiErrors > 0 || schemaFailures.length > 0) process.exit(1);
}

main().catch((err: unknown) => {
  log.error('debug-layer2 failed:', err);
  process.exit(1);
});
