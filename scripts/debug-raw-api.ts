#!/usr/bin/env npx tsx

/**
 * Diagnostic script — captures 100% of raw Gmail API responses from Layer 1.
 * No truncation, no filtering, no summarization. Complete payloads as returned
 * by googleapis. Output is written to scripts/debug-raw-output.json.
 *
 * Usage: npx tsx scripts/debug-raw-api.ts
 */

import { ensureAuthenticated } from '../src/auth.js';
import { GmailClient } from '../src/client/index.js';
import { logger } from '../src/logger.js';
import fs from 'node:fs';

const log = logger.child('debug');

async function main() {
  const auth = await ensureAuthenticated('./credentials.json', './token.json');
  const client = new GmailClient(auth);

  const output: Record<string, unknown> = {};

  // --- Messages ---

  const messageList = await client.messages.list({ query: 'newer_than:3d', maxResults: 5 });
  output['messages.list'] = messageList;

  const sampleId = messageList.messages[0]?.id;
  if (sampleId) {
    output['messages.get(full)'] = await client.messages.get(sampleId, 'full');
    output['messages.get(metadata)'] = await client.messages.get(sampleId, 'metadata', [
      'From',
      'To',
      'Cc',
      'Subject',
      'Date',
    ]);
    output['messages.get(minimal)'] = await client.messages.get(sampleId, 'minimal');
    output['messages.get(raw)'] = await client.messages.get(sampleId, 'raw');
  }

  const batchIds = messageList.messages.slice(0, 3).map((m) => m.id);
  if (batchIds.length > 0) {
    output['messages.batchGet(metadata)'] = await client.messages.batchGet(batchIds, 'metadata', [
      'From',
      'To',
      'Cc',
      'Subject',
      'Date',
    ]);
    output['messages.batchGet(full)'] = await client.messages.batchGet(batchIds, 'full');
  }

  // --- Threads ---

  const threadList = await client.threads.list({ query: 'newer_than:7d', maxResults: 3 });
  output['threads.list'] = threadList;

  const sampleThreadId = threadList.threads[0]?.id;
  if (sampleThreadId) {
    output['threads.get(full)'] = await client.threads.get(sampleThreadId, 'full');
    output['threads.get(metadata)'] = await client.threads.get(sampleThreadId, 'metadata');
  }

  // --- Labels ---

  output['labels.list'] = await client.labels.list();

  const allLabels = await client.labels.list();
  for (const label of allLabels) {
    if (label.id != null) {
      output[`labels.get(${label.id})`] = await client.labels.get(label.id);
    }
  }

  // --- Drafts ---

  const draftList = await client.drafts.list({ maxResults: 10 });
  output['drafts.list'] = draftList;

  for (const draft of draftList.drafts) {
    if (draft.id) {
      output[`drafts.get(full:${draft.id})`] = await client.drafts.get(draft.id, 'full');
      output[`drafts.get(metadata:${draft.id})`] = await client.drafts.get(draft.id, 'metadata');
    }
  }

  // --- Filters ---

  const filterList = await client.filters.list();
  output['filters.list'] = filterList;

  for (const filter of filterList) {
    if (filter.id != null) {
      output[`filters.get(${filter.id})`] = await client.filters.get(filter.id);
    }
  }

  // --- Settings ---

  output['settings.getProfile'] = await client.settings.getProfile();
  output['settings.getVacation'] = await client.settings.getVacation();
  output['settings.getAutoForwarding'] = await client.settings.getAutoForwarding();
  output['settings.getImap'] = await client.settings.getImap();
  output['settings.getPop'] = await client.settings.getPop();
  output['settings.listSendAs'] = await client.settings.listSendAs();
  output['settings.listForwardingAddresses'] = await client.settings.listForwardingAddresses();

  try {
    output['settings.listDelegates'] = await client.settings.listDelegates();
  } catch (err) {
    output['settings.listDelegates'] = { error: err instanceof Error ? err.message : String(err) };
  }

  // --- History ---

  const profile = await client.settings.getProfile();
  if (profile.historyId != null) {
    try {
      output['history.list'] = await client.history.list({ startHistoryId: profile.historyId });
    } catch (err) {
      output['history.list'] = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Write complete unfiltered output
  const outPath = './scripts/debug-raw-output.json';
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  const stats = fs.statSync(outPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  log.info(`Output: ${outPath} (${sizeMB} MB)`);
  log.info(`Endpoints: ${Object.keys(output).length}`);
}

main().catch((err: unknown) => {
  log.error('Debug script failed:', err);
  process.exit(1);
});
