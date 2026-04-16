/**
 * Gmail Toolkit — Shared Helpers for Composed Operations
 *
 * Contact parsing, header extraction, and other utilities
 * shared across multiple composed operation modules.
 */

import type { gmail_v1 } from 'googleapis';
import type { Contact } from '../shared/index.js';
import he from 'he';

/**
 * Parse a single email contact string into a Contact object.
 * Handles formats: "Name <email>", "<email>", "email"
 * @param raw - The raw contact string to parse
 * @returns A Contact object with parsed name and email
 */
export function parseContact(raw: string): Contact {
  const trimmed = raw.trim();
  if (!trimmed) return { name: null, email: '' };

  // "Display Name <email@example.com>"
  const match = /^(.+?)\s*<([^>]+)>$/.exec(trimmed);
  if (match) {
    const name = match[1].replace(/^["']|["']$/g, '').trim();
    return { name: name || null, email: match[2].trim().toLowerCase() };
  }

  // "<email@example.com>"
  const angleMatch = /^<([^>]+)>$/.exec(trimmed);
  if (angleMatch) {
    return { name: null, email: angleMatch[1].trim().toLowerCase() };
  }

  // Plain email
  return { name: null, email: trimmed.toLowerCase() };
}

/**
 * Parse a comma-separated list of contacts.
 * Handles quoted names containing commas.
 * @param raw - The comma-separated contact list string
 * @returns An array of parsed Contact objects
 */
export function parseContactList(raw: string): Contact[] {
  if (!raw.trim()) return [];

  const contacts: Contact[] = [];
  let current = '';
  let inQuotes = false;
  let depth = 0;

  for (const char of raw) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === '<') depth++;
    if (char === '>') depth--;
    if (char === ',' && !inQuotes && depth === 0) {
      const parsed = parseContact(current);
      if (parsed.email) contacts.push(parsed);
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    const parsed = parseContact(current);
    if (parsed.email) contacts.push(parsed);
  }

  return contacts;
}

/**
 * Decode HTML entities and strip invisible Unicode spacers from email snippets.
 * ESPs embed zero-width characters (U+034F, U+200B–U+200F, etc.) as tracking
 * spacers in plain-text snippets. These degrade downstream text processing.
 * @param raw - The raw snippet string from the Gmail API
 * @returns Cleaned, human-readable snippet text
 */
export function cleanSnippet(raw: string): string {
  return he
    .decode(raw)
    .replace(/[\u034f\u00ad\u200b-\u200f\u2028\u2029\ufeff\u2060]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Construct a Gmail web UI URL for a given message.
 * @param messageId - The Gmail message ID to link to
 * @returns The full Gmail web UI URL for the message
 */
export function gmailWebUrl(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${messageId}`;
}

/**
 * Deduplicate contacts by email address (case-insensitive).
 * Keeps the first occurrence (which typically has the most complete name).
 * @param contacts - The contact array to deduplicate
 * @returns Deduplicated contacts preserving the first occurrence of each email
 */
export function deduplicateContacts(contacts: Contact[]): Contact[] {
  const seen = new Set<string>();
  return contacts.filter((c) => {
    const key = c.email.toLowerCase();
    const isNew = !seen.has(key);
    if (isNew) {
      seen.add(key);
    }
    return isNew;
  });
}

// ---------------------------------------------------------------------------
// Header & Date Utilities
// ---------------------------------------------------------------------------

/**
 * Build a Map from Gmail message headers for fast lookup.
 * @param headers - The raw Gmail message headers to index
 * @returns A Map keyed by header name for fast lookup
 */
export function headerMap(headers: gmail_v1.Schema$MessagePartHeader[]): Map<string, string> {
  return new Map(
    headers
      .filter((h): h is { name: string; value: string } => h.name != null && h.value != null)
      .map((h) => [h.name, h.value] as const),
  );
}

/**
 * Parse a date string to ISO 8601, falling back to the raw string.
 * @param dateStr - The date string to parse
 * @returns ISO 8601 date string, or the raw input on parse failure
 */
export function parseDate(dateStr: string): string {
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Attachment Detection
// ---------------------------------------------------------------------------

/**
 * Detect whether a message payload contains attachments.
 *
 * In full format, walks the complete MIME tree checking filenames,
 * Content-Disposition headers, and attachment IDs.
 *
 * In metadata format, the payload has NO parts or body — only mimeType
 * and headers. Falls back to a size heuristic: large (>100KB) multipart
 * messages likely have attachments invisible in the truncated payload.
 * @param payload - The Gmail message payload to inspect
 * @param sizeEstimate - The message size estimate in bytes for heuristic fallback
 * @returns True if the message appears to have attachments
 */
export function hasAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined,
  sizeEstimate?: number | null,
): boolean {
  if (payload == null) {
    return false;
  }

  function walk(part: gmail_v1.Schema$MessagePart): boolean {
    if (part.filename != null && part.filename.length > 0 && part.body?.attachmentId != null) {
      return true;
    }
    if (
      part.filename != null &&
      part.filename.length > 0 &&
      part.mimeType !== 'text/plain' &&
      part.mimeType !== 'text/html'
    ) {
      return true;
    }
    const disposition = (part.headers ?? []).find(
      (h) => h.name?.toLowerCase() === 'content-disposition',
    );
    if (disposition?.value?.toLowerCase().startsWith('attachment') === true) {
      return true;
    }
    return (part.parts ?? []).some((p) => walk(p));
  }

  if (walk(payload)) {
    return true;
  }

  // Metadata format fallback: payload has NO parts/body — only mimeType.
  // A large multipart message likely has attachments we can't see.
  if (
    sizeEstimate != null &&
    sizeEstimate > 100_000 &&
    payload.parts == null &&
    payload.mimeType?.startsWith('multipart/') === true
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Message Field Normalization
// ---------------------------------------------------------------------------

/**
 * Common message fields shared by both MessageSummary and FullMessage.
 * Produced by normalizeMessageFields — the single source of truth for
 * header parsing, date resolution, and flag extraction.
 *
 * Note: `history_id` and `web_url` are intentionally omitted here.
 * They are added explicitly by `transformMessage` for FullMessage results.
 * List/search callers (MessageSummary) do not include them to reduce payload size.
 */
export interface NormalizedMessageFields {
  id: string;
  thread_id: string;
  from: Contact;
  to: Contact[];
  /** Absent when the message has no CC recipients. */
  cc?: Contact[];
  subject: string;
  date: string;
  labels: string[];
  is_unread: boolean;
  is_starred: boolean;
  is_mailing_list: boolean;
  /** Absent when the message has no Reply-To header. */
  reply_to?: Contact;
  size_bytes: number;
}

/**
 * Normalize a raw Gmail API message into common fields shared by all
 * message representations. Pure function — no async, no cache, no body
 * processing. Callers add type-specific fields (body, attachments, snippet).
 *
 * Single source of truth for: internalDate preference over Date header,
 * Reply-To parsing, contact extraction, and label flag derivation.
 * @param raw - The raw Gmail API message object
 * @param resolvedLabels - Pre-resolved human-readable label names
 * @returns Normalized fields common to MessageSummary and FullMessage
 */
export function normalizeMessageFields(
  raw: gmail_v1.Schema$Message,
  resolvedLabels: string[],
): NormalizedMessageFields {
  const headers = headerMap(raw.payload?.headers ?? []);
  const labelIds = raw.labelIds ?? [];

  const date =
    raw.internalDate != null
      ? new Date(Number(raw.internalDate)).toISOString()
      : parseDate(headers.get('Date') ?? '');

  const replyToRaw = headers.get('Reply-To');
  const replyTo = replyToRaw != null && replyToRaw !== '' ? parseContact(replyToRaw) : undefined;

  const cc = parseContactList(headers.get('Cc') ?? '');

  return {
    id: raw.id ?? '',
    thread_id: raw.threadId ?? '',
    from: parseContact(headers.get('From') ?? ''),
    to: parseContactList(headers.get('To') ?? ''),
    ...(cc.length > 0 ? { cc } : {}),
    subject: headers.get('Subject') ?? '(no subject)',
    date,
    labels: resolvedLabels,
    is_unread: labelIds.includes('UNREAD'),
    is_starred: labelIds.includes('STARRED'),
    is_mailing_list: headers.has('List-Unsubscribe'),
    ...(replyTo != null ? { reply_to: replyTo } : {}),
    size_bytes: raw.sizeEstimate ?? 0,
  };
}

// ---------------------------------------------------------------------------
// RFC 2822 Message Building
// ---------------------------------------------------------------------------

/**
 * Build an RFC 2822 compliant email message string from structured options.
 * Shared by draft creation and direct message sending.
 * @param options - The message composition options
 * @param options.to - Recipient email address
 * @param options.cc - CC recipient email addresses
 * @param options.bcc - BCC recipient email addresses
 * @param options.subject - The email subject line
 * @param options.body - The email body content
 * @param options.contentType - MIME content type (defaults to 'text/plain')
 * @returns The RFC 2822 formatted message string
 */
export function buildRfc2822Message(options: {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body: string;
  contentType?: string;
}): string {
  const lines: string[] = [];
  if (options.to != null) {
    lines.push(`To: ${options.to}`);
  }
  if (options.cc != null) {
    lines.push(`Cc: ${options.cc}`);
  }
  if (options.bcc != null) {
    lines.push(`Bcc: ${options.bcc}`);
  }
  if (options.subject != null) {
    lines.push(`Subject: ${options.subject}`);
  }
  lines.push(`Content-Type: ${options.contentType ?? 'text/plain'}; charset=utf-8`);
  lines.push('');
  lines.push(options.body);
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// Label Change Formatting
// ---------------------------------------------------------------------------

/**
 * Format a human-readable summary of label additions and removals.
 * Used by message and thread modification operations.
 * @param addLabels - Label names that were added
 * @param removeLabels - Label names that were removed
 * @returns A formatted string summarizing the label changes
 */
export function formatLabelChanges(addLabels: string[], removeLabels: string[]): string {
  return `${addLabels.length > 0 ? ` Added: ${addLabels.join(', ')}.` : ''}${removeLabels.length > 0 ? ` Removed: ${removeLabels.join(', ')}.` : ''}`;
}
