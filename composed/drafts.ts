/**
 * Gmail Toolkit — Draft Composed Operations
 */

import { GmailClient } from '../client/index.js';
import { LabelCache } from './labels.js';
import { parseContact, parseContactList } from './helpers.js';
import type { DraftSummary, DraftDetail } from '../types.js';
import he from 'he';

export async function getDrafts(
  client: GmailClient,
  labelCache: LabelCache,
  maxResults = 10,
  query?: string,
): Promise<DraftSummary> {
  const listResult = await client.drafts.list({ maxResults, query });

  if (listResult.drafts.length === 0) {
    return { total: listResult.resultSizeEstimate, drafts: [] };
  }

  const ids = listResult.drafts.map((d) => d.id);
  const rawDrafts = await client.drafts.batchGet(ids, 'metadata');

  const drafts: DraftDetail[] = rawDrafts.map((raw) => {
    const msg = raw.message;
    const headers = new Map<string, string>();
    for (const h of msg?.payload?.headers ?? []) {
      if (h.name && h.value) headers.set(h.name, h.value);
    }

    return {
      draft_id: raw.id ?? '',
      message_id: msg?.id ?? '',
      thread_id: msg?.threadId ?? null,
      to: parseContactList(headers.get('To') ?? ''),
      cc: parseContactList(headers.get('Cc') ?? ''),
      subject: headers.get('Subject') ?? null,
      snippet: he.decode(msg?.snippet ?? ''),
      date: parseDate(headers.get('Date') ?? ''),
      size_bytes: msg?.sizeEstimate ?? 0,
      has_attachments: hasAttachments(msg?.payload),
    };
  });

  return { total: listResult.resultSizeEstimate, drafts };
}

/**
 * Create a new draft from structured input.
 */
export async function createDraft(
  client: GmailClient,
  options: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body: string;
    contentType?: 'text/plain' | 'text/html';
    threadId?: string;
  },
): Promise<DraftDetail> {
  const raw = buildRfc2822Message(options);
  const encoded = Buffer.from(raw).toString('base64url');
  const draft = await client.drafts.create(encoded, options.threadId);

  const msg = draft.message;
  const headers = new Map<string, string>();
  for (const h of msg?.payload?.headers ?? []) {
    if (h.name && h.value) headers.set(h.name, h.value);
  }

  return {
    draft_id: draft.id ?? '',
    message_id: msg?.id ?? '',
    thread_id: msg?.threadId ?? null,
    to: parseContactList(headers.get('To') ?? ''),
    cc: parseContactList(headers.get('Cc') ?? ''),
    subject: headers.get('Subject') ?? null,
    snippet: he.decode(msg?.snippet ?? ''),
    date: new Date().toISOString(),
    size_bytes: msg?.sizeEstimate ?? 0,
    has_attachments: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRfc2822Message(options: {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body: string;
  contentType?: string;
}): string {
  const lines: string[] = [];
  if (options.to) lines.push(`To: ${options.to}`);
  if (options.cc) lines.push(`Cc: ${options.cc}`);
  if (options.bcc) lines.push(`Bcc: ${options.bcc}`);
  if (options.subject) lines.push(`Subject: ${options.subject}`);
  lines.push(`Content-Type: ${options.contentType ?? 'text/plain'}; charset=utf-8`);
  lines.push('');
  lines.push(options.body);
  return lines.join('\r\n');
}

function parseDate(dateStr: string): string {
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return dateStr;
  }
}

function hasAttachments(payload: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = payload as any;
  if (!p) return false;
  if (p.filename && p.filename.length > 0 && p.body?.attachmentId) return true;
  return (p.parts ?? []).some((part: unknown) => hasAttachments(part));
}
