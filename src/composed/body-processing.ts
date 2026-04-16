/**
 * Gmail Toolkit — Body Processing Pipeline
 *
 * Transforms raw email bodies into clean, token-efficient plain text.
 * Uses proven libraries for the hard problems, minimal custom code for the rest.
 *
 * Pipeline (operates on pre-parsed Gmail API payloads, not raw MIME):
 *   1. Payload → text (findPart + html-to-text)
 *   2. Strip quoted reply chains (email-reply-parser)
 *   3. Strip standard signatures (RFC 3676 "-- \n" and "Sent from...")
 *   4. Remove CID image references
 *   5. Shorten tracking URLs
 *   6. Decode HTML entities (he)
 *   7. Collapse whitespace
 */

import { convert as htmlToText } from 'html-to-text';

import he from 'he';
import { logger } from '../shared/index.js';

const log = logger.child('composed:body-processing');

// email-reply-parser v2 ships as CJS with a default export constructor.
// We type the constructor explicitly to avoid `any` throughout.
interface ReplyParser {
  parseReply: (text: string) => string;
}
type ReplyParserConstructor = new () => ReplyParser;

// ---------------------------------------------------------------------------
// Reply Parser Cache
// ---------------------------------------------------------------------------

/**
 * Lazily loads and caches the email-reply-parser module constructor.
 * Encapsulates the mutable singleton to prevent uncontrolled module-scope state.
 */
class ReplyParserCache {
  private instance: ReplyParserConstructor | undefined;

  /**
   * Return a fresh ReplyParser instance, loading the module on first call.
   * @returns A ReplyParser instance ready to parse replies
   */
  async get(): Promise<ReplyParser> {
    if (this.instance == null) {
      const mod = (await import('email-reply-parser')) as {
        default?: ReplyParserConstructor;
      } & Record<string, unknown>;
      this.instance = (mod.default ?? mod) as ReplyParserConstructor;
    }
    return new this.instance();
  }
}

const replyParserCache = new ReplyParserCache();

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
    parts?: { mimeType?: string | null; body?: { data?: string | null }; parts?: unknown[] }[];
  },
  mimeType: string | undefined,
  options: { stripReplies?: boolean; includeHtml?: boolean } = {},
): Promise<{ text: string; html: string | null }> {
  const { stripReplies = true, includeHtml = false } = options;

  let text = '';
  let html: string | null = null;

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

  return {
    text: await applyCleaningPipeline(text, stripReplies),
    html,
  };
}

// ---------------------------------------------------------------------------
// Shared Cleaning Pipeline
// ---------------------------------------------------------------------------

/**
 * Apply the shared text-cleaning pipeline (steps 2–7) to extracted email text.
 * Shared by both {@link processBody} and {@link processMessagePayload} to
 * eliminate duplication. Operates on already-extracted plain text.
 * @param text - The raw extracted text to clean
 * @param stripReplies - Whether to strip quoted reply chains
 * @returns The cleaned, normalised plain text
 */
async function applyCleaningPipeline(text: string, stripReplies: boolean): Promise<string> {
  // 1. Strip any residual HTML that survived extraction
  let result = stripResidualHtml(text);

  // 2. Strip quoted reply chains (skip for thread reads)
  if (stripReplies) {
    result = await stripReplyChain(result);
  }

  // 3. Strip standard signatures
  result = trimStandardSignature(result);

  // 4. Remove CID image references and [image: ...] markers
  result = result.replace(/\[cid:[^\]]+\]/g, '').replace(/\[image:[^\]]+\]/g, '[image]');

  // 5. Shorten tracking URLs
  result = shortenTrackingUrls(result);

  // 6. Decode HTML entities
  result = he.decode(result);

  // 7. Collapse excessive whitespace
  return result.replace(/\n{3,}/g, '\n\n').trim();
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

  if (/<html[\s>]/i.test(text) || /<!doctype\s+html/i.test(text)) {
    return htmlToText(text, HTML_TO_TEXT_OPTIONS);
  }

  if (
    /<\/?(?:strong|em|b|i|u|a|span|div|p|br|h[1-6]|ul|ol|li|table|tr|td|th|img|font|center|blockquote)\b[^>]*>/i.test(
      text,
    )
  ) {
    return htmlToText(text, HTML_TO_TEXT_OPTIONS);
  }

  return text;
}

async function stripReplyChain(text: string): Promise<string> {
  try {
    const parser = await replyParserCache.get();
    const result = parser.parseReply(text);
    return result || text;
  } catch (err) {
    log.debug('email-reply-parser failed, returning unstripped text', err);
    return text;
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
  const sigDelimiterIndex = text.indexOf('\n-- \n');
  const base = sigDelimiterIndex !== -1 ? text.substring(0, sigDelimiterIndex) : text;

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
  const alwaysTrackingDomains = [
    /\.list-manage\.com/i,
    /email\.mg\./i,
    /sendgrid\.net/i,
    /mandrillapp\.com/i,
    /click\.\w+\.com/i,
    /links\.\w+\.com/i,
    /track\.\w+\.com/i,
    /t\.co\//i,
    /bit\.ly\//i,
    /mailchimp\.com/i,
    /constantcontact\.com/i,
    /hubspot\.com.*\/track/i,
    /mkto-\w+/i,
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
    parts?: { mimeType?: string | null; body?: unknown; parts?: unknown[] }[];
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
