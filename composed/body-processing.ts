/**
 * Gmail Toolkit — Body Processing Pipeline
 *
 * Transforms raw email bodies into clean, token-efficient plain text.
 * Uses proven libraries for the hard problems, minimal custom code for the rest.
 *
 * Pipeline:
 *   1. MIME → text (mailparser + html-to-text)
 *   2. Strip quoted reply chains (email-reply-parser)
 *   3. Strip standard signatures (RFC 3676 "-- \n" and "Sent from...")
 *   4. Remove CID image references
 *   5. Shorten tracking URLs
 *   6. Decode HTML entities (he)
 *   7. Collapse whitespace
 */

import { convert as htmlToText } from 'html-to-text';
import { simpleParser, type ParsedMail } from 'mailparser';
import he from 'he';

// email-reply-parser v2 ships as CJS with default export class
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ReplyParserClass: any;

async function getReplyParser(): Promise<{ parseReply: (text: string) => string }> {
  if (!ReplyParserClass) {
    const mod = await import('email-reply-parser');
    ReplyParserClass = mod.default ?? mod;
  }
  return new ReplyParserClass();
}

// ---------------------------------------------------------------------------
// HTML → Text Configuration
// ---------------------------------------------------------------------------

const HTML_TO_TEXT_OPTIONS = {
  wordwrap: false as false,
  preserveNewlines: true,
  selectors: [
    { selector: 'a', options: { ignoreHref: false } },
    { selector: 'img', format: 'skip' as const },
    { selector: 'table', format: 'dataTable' as const },
  ],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process a raw MIME message body into clean plain text.
 *
 * @param rawMessage - Raw RFC 2822 message (base64url or Buffer)
 * @param options.stripReplies - Whether to strip quoted reply chains (default: true).
 *   Set to false for thread reads where full conversation context matters.
 * @param options.includeHtml - Whether to also return the raw HTML body.
 */
export async function processBody(
  rawMessage: string | Buffer,
  options: { stripReplies?: boolean; includeHtml?: boolean } = {},
): Promise<{ text: string; html: string | null }> {
  const { stripReplies = true, includeHtml = false } = options;

  // Parse MIME tree
  const parsed = await simpleParser(
    typeof rawMessage === 'string' ? Buffer.from(rawMessage, 'base64url' as BufferEncoding) : rawMessage,
  );

  let text = extractText(parsed);

  // 2. Strip quoted reply chains (skip for thread reads)
  if (stripReplies) {
    text = await stripReplyChain(text);
  }

  // 3. Strip standard signatures
  text = trimStandardSignature(text);

  // 4. Remove CID image references and [image: ...] markers
  text = text
    .replace(/\[cid:[^\]]+\]/g, '')
    .replace(/\[image:[^\]]+\]/g, '[image]');

  // 5. Shorten tracking URLs
  text = shortenTrackingUrls(text);

  // 6. Decode HTML entities
  text = he.decode(text);

  // 7. Collapse excessive whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return {
    text,
    html: includeHtml ? (parsed.html || null) : null,
  };
}

/**
 * Process a gmail_v1.Schema$Message (already fetched in FULL format)
 * without re-parsing MIME. Operates on the payload parts directly.
 */
export async function processMessagePayload(
  payload: { body?: { data?: string | null }; parts?: Array<{ mimeType?: string | null; body?: { data?: string | null }; parts?: unknown[] }> },
  mimeType: string | undefined,
  options: { stripReplies?: boolean; includeHtml?: boolean } = {},
): Promise<{ text: string; html: string | null }> {
  const { stripReplies = true, includeHtml = false } = options;

  let text = '';
  let html: string | null = null;

  // Extract text and HTML from payload parts
  const textPart = findPart(payload, 'text/plain');
  const htmlPart = findPart(payload, 'text/html');

  if (textPart?.body?.data) {
    text = Buffer.from(textPart.body.data, 'base64url' as BufferEncoding).toString('utf-8');
  } else if (htmlPart?.body?.data) {
    const rawHtml = Buffer.from(htmlPart.body.data, 'base64url' as BufferEncoding).toString('utf-8');
    text = htmlToText(rawHtml, HTML_TO_TEXT_OPTIONS);
    if (includeHtml) html = rawHtml;
  } else if (payload.body?.data) {
    // Simple single-part message
    if (mimeType === 'text/html') {
      const rawHtml = Buffer.from(payload.body.data, 'base64url' as BufferEncoding).toString('utf-8');
      text = htmlToText(rawHtml, HTML_TO_TEXT_OPTIONS);
      if (includeHtml) html = rawHtml;
    } else {
      text = Buffer.from(payload.body.data, 'base64url' as BufferEncoding).toString('utf-8');
    }
  }

  if (includeHtml && !html && htmlPart?.body?.data) {
    html = Buffer.from(htmlPart.body.data, 'base64url' as BufferEncoding).toString('utf-8');
  }

  // Apply pipeline steps 2-7
  if (stripReplies) {
    text = await stripReplyChain(text);
  }
  text = trimStandardSignature(text);
  text = text
    .replace(/\[cid:[^\]]+\]/g, '')
    .replace(/\[image:[^\]]+\]/g, '[image]');
  text = shortenTrackingUrls(text);
  text = he.decode(text);
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return { text, html };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function extractText(parsed: ParsedMail): string {
  if (parsed.text) return parsed.text;
  if (parsed.html) return htmlToText(parsed.html, HTML_TO_TEXT_OPTIONS);
  return '';
}

async function stripReplyChain(text: string): Promise<string> {
  try {
    const parser = await getReplyParser();
    const result = parser.parseReply(text);
    return result || text; // fall back to full text if parser returns empty
  } catch {
    return text; // non-fatal — return unmodified
  }
}

/**
 * Strip standard email signatures:
 *   - RFC 3676 delimiter: "-- \n" (dash dash space newline)
 *   - "Sent from my iPhone/iPad/Galaxy/etc."
 *   - "Get Outlook for iOS/Android"
 */
function trimStandardSignature(text: string): string {
  // RFC 3676 standard signature delimiter
  const sigDelimiterIndex = text.indexOf('\n-- \n');
  if (sigDelimiterIndex !== -1) {
    text = text.substring(0, sigDelimiterIndex);
  }

  // Common mobile / app signatures
  const mobilePatterns = [
    /\n?Sent from my [^\n]+$/i,
    /\n?Sent from Mail for [^\n]+$/i,
    /\n?Get Outlook for [^\n]+$/i,
    /\n?Sent from Yahoo Mail[^\n]*$/i,
  ];

  for (const pattern of mobilePatterns) {
    text = text.replace(pattern, '');
  }

  return text;
}

/**
 * Shorten tracking URLs (>100 chars with tracking patterns) to [link: domain.com].
 * Preserves short URLs and non-tracking long URLs.
 */
function shortenTrackingUrls(text: string): string {
  const trackingPatterns = [
    /utm_/i,
    /\/track\//i,
    /\/click\//i,
    /\/redirect\//i,
    /\/link\//i,
    /\.list-manage\.com/i,
    /email\.mg\./i,
    /sendgrid\.net/i,
    /mandrillapp\.com/i,
  ];

  // Match URLs (http/https)
  return text.replace(
    /https?:\/\/[^\s<>"{}|\\^`[\]]+/g,
    (url) => {
      if (url.length <= 100) return url;

      const isTracking = trackingPatterns.some((p) => p.test(url));
      if (!isTracking) return url;

      try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        return `[link: ${domain}]`;
      } catch {
        return '[link]';
      }
    },
  );
}

/**
 * Recursively find a part by MIME type in a message payload.
 */
function findPart(
  payload: { mimeType?: string | null; body?: unknown; parts?: Array<{ mimeType?: string | null; body?: unknown; parts?: unknown[] }> },
  targetMimeType: string,
): { body?: { data?: string | null } } | undefined {
  if (payload.mimeType === targetMimeType) {
    return payload as { body?: { data?: string | null } };
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findPart(part as typeof payload, targetMimeType);
      if (found) return found;
    }
  }
  return undefined;
}
