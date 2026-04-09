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
import { logger } from '../logger.js';

const log = logger.child('composed:body-processing');

// email-reply-parser v2 ships as CJS with a default export constructor.
// We type the constructor explicitly to avoid `any` throughout.
interface ReplyParser {
  parseReply: (text: string) => string;
}
type ReplyParserConstructor = new () => ReplyParser;

let CachedParserClass: ReplyParserConstructor | undefined;

async function getReplyParser(): Promise<ReplyParser> {
  if (CachedParserClass == null) {
    const mod = (await import('email-reply-parser')) as {
      default?: ReplyParserConstructor;
    } & Record<string, unknown>;
    CachedParserClass = (mod.default ?? mod) as ReplyParserConstructor;
  }
  return new CachedParserClass();
}

// ---------------------------------------------------------------------------
// HTML → Text Configuration
// ---------------------------------------------------------------------------

const HTML_TO_TEXT_OPTIONS = {
  wordwrap: false as const,
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
 * @param rawMessage - Raw RFC 2822 message (base64url or Buffer)
 * @param options - Processing options for reply stripping and HTML inclusion
 * @param options.stripReplies - Whether to strip quoted reply chains (default: true).
 *   Set to false for thread reads where full conversation context matters.
 * @param options.includeHtml - Whether to also return the raw HTML body.
 * @returns The extracted plain text and optional HTML content
 */
export async function processBody(
  rawMessage: string | Buffer,
  options: { stripReplies?: boolean; includeHtml?: boolean } = {},
): Promise<{ text: string; html: string | null }> {
  const { stripReplies = true, includeHtml = false } = options;

  // Parse MIME tree
  const parsed = await simpleParser(
    typeof rawMessage === 'string'
      ? Buffer.from(rawMessage, 'base64url' as BufferEncoding)
      : rawMessage,
  );

  let text = extractText(parsed);

  // 1b. If text looks like raw HTML (missed conversion), convert it now
  text = stripResidualHtml(text);

  // 2. Strip quoted reply chains (skip for thread reads)
  if (stripReplies) {
    text = await stripReplyChain(text);
  }

  // 3. Strip standard signatures
  text = trimStandardSignature(text);

  // 4. Remove CID image references and [image: ...] markers
  text = text.replace(/\[cid:[^\]]+\]/g, '').replace(/\[image:[^\]]+\]/g, '[image]');

  // 5. Shorten tracking URLs
  text = shortenTrackingUrls(text);

  // 6. Decode HTML entities
  text = he.decode(text);

  // 7. Collapse excessive whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return {
    text,
    html: includeHtml && typeof parsed.html === 'string' ? parsed.html : null,
  };
}

/**
 * Process a gmail_v1.Schema$Message (already fetched in FULL format)
 * without re-parsing MIME. Operates on the payload parts directly.
 * @param payload - The Gmail message payload with MIME parts
 * @param payload.mimeType - The top-level MIME type of the payload
 * @param payload.body - The payload body containing base64url data
 * @param payload.body.data - The base64url-encoded body content
 * @param payload.parts - Nested MIME parts for multipart messages
 * @param mimeType - The content type from the message metadata
 * @param options - Processing options for reply stripping and HTML inclusion
 * @param options.stripReplies - Whether to strip quoted reply chains
 * @param options.includeHtml - Whether to also return the raw HTML body
 * @returns The extracted plain text and optional HTML content
 */
export async function processMessagePayload(
  payload: {
    mimeType?: string | null;
    body?: { data?: string | null };
    parts?: Array<{ mimeType?: string | null; body?: { data?: string | null }; parts?: unknown[] }>;
  },
  mimeType: string | undefined,
  options: { stripReplies?: boolean; includeHtml?: boolean } = {},
): Promise<{ text: string; html: string | null }> {
  const { stripReplies = true, includeHtml = false } = options;

  let text = '';
  let html: string | null = null;

  // Extract text and HTML from payload parts
  const textPart = findPart(payload, 'text/plain');
  const htmlPart = findPart(payload, 'text/html');

  if (textPart?.body?.data != null) {
    text = Buffer.from(textPart.body.data, 'base64url' as BufferEncoding).toString('utf-8');
  } else if (htmlPart?.body?.data != null) {
    const rawHtml = Buffer.from(htmlPart.body.data, 'base64url' as BufferEncoding).toString(
      'utf-8',
    );
    text = htmlToText(rawHtml, HTML_TO_TEXT_OPTIONS);
    if (includeHtml) html = rawHtml;
  } else if (payload.body?.data != null) {
    // Simple single-part message
    if (mimeType === 'text/html') {
      const rawHtml = Buffer.from(payload.body.data, 'base64url' as BufferEncoding).toString(
        'utf-8',
      );
      text = htmlToText(rawHtml, HTML_TO_TEXT_OPTIONS);
      if (includeHtml) html = rawHtml;
    } else {
      text = Buffer.from(payload.body.data, 'base64url' as BufferEncoding).toString('utf-8');
    }
  }

  if (includeHtml && html == null && htmlPart?.body?.data != null) {
    html = Buffer.from(htmlPart.body.data, 'base64url' as BufferEncoding).toString('utf-8');
  }

  // If text looks like raw HTML (missed conversion), convert it now
  text = stripResidualHtml(text);

  // Apply pipeline steps 2-7
  if (stripReplies) {
    text = await stripReplyChain(text);
  }
  text = trimStandardSignature(text);
  text = text.replace(/\[cid:[^\]]+\]/g, '').replace(/\[image:[^\]]+\]/g, '[image]');
  text = shortenTrackingUrls(text);
  text = he.decode(text);
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return { text, html };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Detect and strip residual HTML that survived extraction.
 * Handles two cases:
 *   1. Entire body is raw HTML (P1: HTML-only email where conversion was skipped)
 *   2. text/plain part contains inline HTML tags (P2: GitHub emails with <strong> etc.)
 * @param text - The text to check for residual HTML
 * @returns The cleaned text with HTML converted or removed
 */
function stripResidualHtml(text: string): string {
  if (!text) return text;

  // Full HTML document — run through html-to-text converter
  if (/<html[\s>]/i.test(text) || /<!doctype\s+html/i.test(text)) {
    return htmlToText(text, HTML_TO_TEXT_OPTIONS);
  }

  // Inline HTML tags in otherwise plain text — strip them
  // Matches common formatting tags that appear in text/plain parts
  if (
    /<\/?(?:strong|em|b|i|u|a|span|div|p|br|h[1-6]|ul|ol|li|table|tr|td|th|img|font|center|blockquote)\b[^>]*>/i.test(
      text,
    )
  ) {
    return htmlToText(text, HTML_TO_TEXT_OPTIONS);
  }

  return text;
}

function extractText(parsed: ParsedMail): string {
  if (typeof parsed.text === 'string' && parsed.text !== '') {
    return parsed.text;
  }
  if (typeof parsed.html === 'string' && parsed.html !== '') {
    return htmlToText(parsed.html, HTML_TO_TEXT_OPTIONS);
  }
  return '';
}

async function stripReplyChain(text: string): Promise<string> {
  try {
    const parser = await getReplyParser();
    const result = parser.parseReply(text);
    return result || text; // fall back to full text if parser returns empty
  } catch (err) {
    log.debug('email-reply-parser failed, returning unstripped text', err);
    return text; // non-fatal — return unmodified
  }
}

/**
 * Strip standard email signatures:
 *   - RFC 3676 delimiter: "-- \n" (dash dash space newline)
 *   - "Sent from my iPhone/iPad/Galaxy/etc."
 *   - "Get Outlook for iOS/Android"
 * @param text - The email body text to strip signatures from
 * @returns The text with standard signatures removed
 */
function trimStandardSignature(text: string): string {
  // RFC 3676 standard signature delimiter
  const sigDelimiterIndex = text.indexOf('\n-- \n');
  const base = sigDelimiterIndex !== -1 ? text.substring(0, sigDelimiterIndex) : text;

  // Common mobile / app signatures
  const mobilePatterns = [
    /\n?Sent from my [^\n]+$/i,
    /\n?Sent from Mail for [^\n]+$/i,
    /\n?Get Outlook for [^\n]+$/i,
    /\n?Sent from Yahoo Mail[^\n]*$/i,
  ];

  return mobilePatterns.reduce((acc, pattern) => acc.replace(pattern, ''), base);
}

/**
 * Shorten tracking URLs to [link: domain.com].
 * Known tracking domains are shortened regardless of length.
 * Other URLs are shortened if >80 chars AND contain tracking patterns.
 * @param text - The text containing URLs to shorten
 * @returns The text with tracking URLs replaced by domain-only references
 */
function shortenTrackingUrls(text: string): string {
  // Domains that are ALWAYS tracking — shorten regardless of URL length
  const alwaysTrackingDomains = [
    /\.list-manage\.com/i,
    /email\.mg\./i,
    /sendgrid\.net/i,
    /mandrillapp\.com/i,
    /click\.\w+\.com/i, // click.example.com pattern
    /links\.\w+\.com/i, // links.example.com pattern
    /track\.\w+\.com/i, // track.example.com pattern
    /t\.co\//i, // Twitter/X shortener
    /bit\.ly\//i,
    /mailchimp\.com/i,
    /constantcontact\.com/i,
    /hubspot\.com.*\/track/i,
    /mkto-\w+/i, // Marketo
    /pardot\.com/i,
    /emltrk\.com/i,
    /awstrack\.me/i,
  ];

  const trackingQueryPatterns = [/utm_/i, /[?&]ref=/i, /[?&]source=/i, /[?&]campaign=/i];

  const pathTrackingPatterns = [
    /\/track\//i,
    /\/click\//i,
    /\/redirect\//i,
    /\/link\//i,
    /\/wf\/click/i,
    /\/e\/c\//i,
  ];

  return text.replace(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g, (url) => {
    // Always shorten known tracking domains
    const isKnownTracker = alwaysTrackingDomains.some((p) => p.test(url));
    if (isKnownTracker) {
      try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        return `[link: ${domain}]`;
      } catch (err) {
        log.debug(`Failed to parse tracking URL, using fallback: ${url}`, err);
        return '[link]';
      }
    }

    // For other URLs, apply length + pattern heuristic
    if (url.length <= 80) return url;

    const hasTrackingQuery = trackingQueryPatterns.some((p) => p.test(url));
    const hasTrackingPath = pathTrackingPatterns.some((p) => p.test(url));

    if (hasTrackingQuery || hasTrackingPath) {
      try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        return `[link: ${domain}]`;
      } catch (err) {
        log.debug(`Failed to parse tracking URL, using fallback: ${url}`, err);
        return '[link]';
      }
    }

    return url;
  });
}

/**
 * Recursively find a part by MIME type in a message payload.
 * @param payload - The message payload to search through
 * @param payload.mimeType - The MIME type of this payload part
 * @param payload.body - The body data of this part
 * @param payload.parts - Nested child parts for multipart payloads
 * @param targetMimeType - The MIME type to search for (e.g. 'text/plain')
 * @returns The first matching part, or undefined if not found
 */
function findPart(
  payload: {
    mimeType?: string | null;
    body?: unknown;
    parts?: Array<{ mimeType?: string | null; body?: unknown; parts?: unknown[] }>;
  },
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
