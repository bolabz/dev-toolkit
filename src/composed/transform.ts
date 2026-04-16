/**
 * Gmail Toolkit — Message Transformer
 *
 * Transforms raw Gmail API messages into fully resolved FullMessage objects.
 * Bridges label resolution (cache) and body processing (pipeline) — the only
 * helper that requires both, which is why it lives in its own module.
 */

import type { gmail_v1 } from 'googleapis';
import type { AttachmentInfo, FullMessage } from '../shared/index.js';
import type { ILabelCache } from './label-cache.js';
import { processMessagePayload } from './body-processing.js';
import { normalizeMessageFields, headerMap, parseContactList, gmailWebUrl } from './helpers.js';

// ---------------------------------------------------------------------------
// transformMessage
// ---------------------------------------------------------------------------

/**
 * Transform a raw Gmail API message into a fully resolved FullMessage.
 * Resolves label IDs to names via the cache, processes the body through the
 * text pipeline, and extracts attachment metadata.
 * @param raw - The raw Gmail API message object
 * @param labelCache - The label cache for resolving label IDs to names
 * @param options - Processing options for body text extraction
 * @param options.stripReplies - Whether to strip quoted reply chains from body text
 * @param options.includeHtml - Whether to include raw HTML alongside plain text
 * @returns A fully resolved message with parsed contacts, labels, and body
 */
export async function transformMessage(
  raw: gmail_v1.Schema$Message,
  labelCache: ILabelCache,
  options: { stripReplies: boolean; includeHtml: boolean },
): Promise<FullMessage> {
  const resolvedLabels = await labelCache.resolve(raw.labelIds ?? []);
  const fields = normalizeMessageFields(raw, resolvedLabels);

  // Body processing and BCC are FullMessage-only concerns
  const { text, html } = await processMessagePayload(
    raw.payload ?? {},
    raw.payload?.mimeType ?? undefined,
    options,
  );
  const headers = headerMap(raw.payload?.headers ?? []);

  const bccList = parseContactList(headers.get('Bcc') ?? '');
  const attachmentList = extractAttachments(raw.payload);

  return {
    ...fields,
    // cc already optional from normalizeMessageFields — pass through as-is
    reply_to: fields.reply_to ?? null,
    // Omit empty arrays and absent history_id to reduce response noise
    ...(bccList.length > 0 ? { bcc: bccList } : {}),
    ...(raw.historyId != null && raw.historyId !== '' ? { history_id: raw.historyId } : {}),
    web_url: gmailWebUrl(raw.id ?? ''),
    body_text: text,
    body_html: html,
    ...(attachmentList.length > 0 ? { attachments: attachmentList } : {}),
  };
}

// ---------------------------------------------------------------------------
// extractAttachments (private — only used by transformMessage)
// ---------------------------------------------------------------------------

/**
 * Extract attachment metadata from a Gmail message payload.
 * Recursively walks the MIME tree to find parts with filenames.
 * @param payload - The Gmail message payload to inspect for attachments
 * @returns An array of attachment metadata (id, filename, MIME type, size)
 */
function extractAttachments(payload: gmail_v1.Schema$MessagePart | undefined): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  if (!payload) {
    return attachments;
  }

  function walk(part: gmail_v1.Schema$MessagePart) {
    if (part.filename != null && part.filename.length > 0) {
      attachments.push({
        id: part.body?.attachmentId ?? '',
        filename: part.filename,
        mime_type: part.mimeType ?? 'application/octet-stream',
        size_bytes: part.body?.size ?? 0,
      });
    }
    for (const child of part.parts ?? []) {
      walk(child);
    }
  }

  walk(payload);
  return attachments;
}
