#!/usr/bin/env npx tsx
/**
 * Live integration test — exercises the GmailToolkit public API against a real
 * Gmail account. Read-only operations only (search, read, labels, account).
 *
 * Usage: npx tsx scripts/live-test.ts
 */

import { GmailToolkit } from '../src/index.js';
import { logger } from '../src/logger.js';

const log = logger.child('live-test');

const PASS = '✅';
const FAIL = '❌';
const SKIP = '⏭️ ';

let passed = 0;
let failed = 0;

function section(title: string) {
  log.info('─'.repeat(60));
  log.info(`  ${title}`);
  log.info('─'.repeat(60));
}

function ok(label: string, detail?: string) {
  passed++;
  log.info(`${PASS}  ${label}${detail !== undefined ? `  →  ${detail}` : ''}`);
}

function fail(label: string, err: unknown) {
  failed++;
  const msg = err instanceof Error ? err.message : String(err);
  log.error(`${FAIL}  ${label}  →  ${msg}`);
}

function skip(label: string, reason: string) {
  log.info(`${SKIP}  ${label}  (${reason})`);
}

async function main() {
  log.info('🔧  Gmail Toolkit — Live Test');
  log.info('   Using credentials.json + token.json');

  // -------------------------------------------------------------------------
  // Auth / init
  // -------------------------------------------------------------------------
  section('1. Initialisation');
  let gmail: GmailToolkit;
  try {
    gmail = await GmailToolkit.create();
    ok('GmailToolkit.create()');
  } catch (err) {
    fail('GmailToolkit.create()', err);
    log.error('⛔  Cannot continue without auth. Exiting.');
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------
  section('2. Account');
  try {
    const account = await gmail.getAccount();
    ok('getAccount()', `${account.email} / ${account.messages_total} messages`);
  } catch (err) {
    fail('getAccount()', err);
  }

  // -------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------
  section('3. Labels');
  let firstUserLabelName: string | undefined;
  try {
    const labels = await gmail.getLabels();
    const total =
      labels.system_labels.length + labels.user_labels.length + labels.categories.length;
    ok(
      'getLabels()',
      `${total} labels total (${labels.user_labels.length} user, ${labels.system_labels.length} system)`,
    );
    firstUserLabelName = labels.user_labels.at(0)?.name;
    if (firstUserLabelName !== undefined) {
      log.info(`       First user label: "${firstUserLabelName}"`);
    }
  } catch (err) {
    fail('getLabels()', err);
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------
  section('4. Search');
  let firstMessageId: string | undefined;
  let firstThreadId: string | undefined;

  try {
    const results = await gmail.search('is:unread', 5);
    ok(
      'search("is:unread", 5)',
      `${results.messages.length} messages returned, total_estimate=${results.total_estimate}`,
    );
    firstMessageId = results.messages[0]?.id;
    firstThreadId = results.messages[0]?.thread_id;
  } catch (err) {
    fail('search("is:unread")', err);
  }

  try {
    const results = await gmail.search('newer_than:7d', 3);
    ok('search("newer_than:7d", 3)', `${results.messages.length} messages`);
  } catch (err) {
    fail('search("newer_than:7d")', err);
  }

  try {
    const results = await gmail.search('newer_than:7d', 2, undefined, true);
    const withBody = results.messages.filter((m) => m.snippet.length > 0).length;
    ok(
      'search(..., includeBody=true)',
      `${results.messages.length} messages, ${withBody} with snippets`,
    );
  } catch (err) {
    fail('search(..., includeBody=true)', err);
  }

  // -------------------------------------------------------------------------
  // Read message
  // -------------------------------------------------------------------------
  section('5. Read Message');
  if (firstMessageId !== undefined) {
    try {
      const msg = await gmail.readMessage(firstMessageId);
      ok(`readMessage(${firstMessageId})`, `from=${msg.from.email}  subject="${msg.subject}"`);
    } catch (err) {
      fail(`readMessage(${firstMessageId})`, err);
    }
  } else {
    skip('readMessage()', 'no message ID available from search');
  }

  // -------------------------------------------------------------------------
  // Read thread
  // -------------------------------------------------------------------------
  section('6. Read Thread');
  if (firstThreadId !== undefined) {
    try {
      const thread = await gmail.readThread(firstThreadId);
      ok(
        `readThread(${firstThreadId})`,
        `${thread.messages.length} messages in thread, participants=${thread.participants.length}`,
      );
    } catch (err) {
      fail(`readThread(${firstThreadId})`, err);
    }
  } else {
    skip('readThread()', 'no thread ID available from search');
  }

  // -------------------------------------------------------------------------
  // Drafts
  // -------------------------------------------------------------------------
  section('7. Drafts');
  try {
    const drafts = await gmail.getDrafts(5);
    ok('getDrafts(5)', `${drafts.drafts.length} drafts`);
  } catch (err) {
    fail('getDrafts()', err);
  }

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------
  section('8. Filters');
  try {
    const filters = await gmail.getFilters();
    ok('getFilters()', `${filters.filters.length} filters configured`);
  } catch (err) {
    fail('getFilters()', err);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  log.info('═'.repeat(60));
  log.info(`  Results: ${PASS} ${passed} passed   ${FAIL} ${failed} failed`);
  log.info('═'.repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  log.error('💥 Unhandled error:', err);
  process.exit(1);
});
