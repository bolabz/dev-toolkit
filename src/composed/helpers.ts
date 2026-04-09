/**
 * Gmail Toolkit — Shared Helpers for Composed Operations
 *
 * Contact parsing, header extraction, and other utilities
 * shared across multiple composed operation modules.
 */

import type { gmail_v1 } from 'googleapis';
import type { Contact } from '../types.js';
import { logger } from '../logger.js';

const log = logger.child('composed:helpers');

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
    return { name: name || null, email: match[2].trim() };
  }

  // "<email@example.com>"
  const angleMatch = /^<([^>]+)>$/.exec(trimmed);
  if (angleMatch) {
    return { name: null, email: angleMatch[1].trim() };
  }

  // Plain email
  return { name: null, email: trimmed };
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
 * Construct a Gmail web UI URL for a given message.
 * Uses #all/ to work regardless of which label the message is under.
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
  } catch (err) {
    log.debug(`Failed to parse date "${dateStr}", returning raw string`, err);
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
// Label Classification
// ---------------------------------------------------------------------------

/**
 * Identify user-created labels by their ID pattern.
 * Gmail user labels always have IDs matching Label_\d+ (e.g., Label_11).
 * System labels have descriptive IDs (INBOX, STARRED, YELLOW_STAR, etc.).
 * @param labelId - The Gmail label ID to classify
 * @returns True if the label is user-created (matches Label_\d+ pattern)
 */
export function isUserLabel(labelId: string): boolean {
  return /^Label_\d+$/.test(labelId);
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
