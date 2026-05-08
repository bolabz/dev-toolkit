/**
 * Gmail Client — Response Validation Schemas
 *
 * Validates Gmail API response shapes at the L1 boundary. Every validated
 * field is read by at least one L2 function (annotated in comments).
 * Uses .loose() to tolerate fields we don't read and future API additions.
 *
 * Schema architecture:
 *   Item schemas    — validate a single resource from get()/batchGet()
 *   List envelopes  — validate paginated list() responses via listSchema() factory
 *   validateResponse() — wraps ZodError → GmailApiError for consistent error taxonomy
 */

import { z, type ZodType } from 'zod';
import { GmailApiError } from '../infra/index.js';

// ---------------------------------------------------------------------------
// Shared MIME Parts
// ---------------------------------------------------------------------------

/** Header — consumed by headerMap() in api/helpers.ts */
const HeaderSchema = z.object({ name: z.string(), value: z.string() }).loose();

/** Body part data — consumed by body-processing.ts, transform.ts */
const BodySchema = z
  .object({
    attachmentId: z.string().optional(),
    size: z.number().optional(),
    data: z.string().optional(),
  })
  .loose();

/** Recursive MIME part — walked by transform.ts and body-processing.ts */
const MessagePartSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z
    .object({
      mimeType: z.string().optional(),
      filename: z.string().optional(),
      headers: z.array(HeaderSchema).optional(),
      body: BodySchema.optional(),
      parts: z.array(MessagePartSchema).optional(),
    })
    .loose(),
);

// ---------------------------------------------------------------------------
// Item Schemas (single resource from get/batchGet)
// ---------------------------------------------------------------------------

/**
 * Full message — validated on get() and batchGet() responses.
 *
 * Field → L2 consumer:
 *   id             → normalizeMessageFields (helpers.ts)
 *   threadId       → normalizeMessageFields (helpers.ts)
 *   labelIds       → normalizeMessageFields, search label/flag checks (messages.ts)
 *   payload        → transformMessage (transform.ts), hasAttachments (helpers.ts)
 *   internalDate   → normalizeMessageFields, search date histogram (messages.ts)
 *   sizeEstimate   → normalizeMessageFields, search size stats (messages.ts)
 *   historyId      → transformMessage (transform.ts)
 *   snippet        → search snippet (messages.ts)
 */
export const GmailMessageSchema = z
  .object({
    id: z.string().nullable().optional(),
    threadId: z.string().nullable().optional(),
    labelIds: z.array(z.string()).optional(),
    snippet: z.string().optional(),
    payload: z
      .object({
        mimeType: z.string().optional(),
        headers: z.array(HeaderSchema).optional(),
        body: BodySchema.optional(),
        parts: z.array(MessagePartSchema).optional(),
        filename: z.string().optional(),
      })
      .loose()
      .optional(),
    internalDate: z.string().nullable().optional(),
    sizeEstimate: z.number().nullable().optional(),
    historyId: z.string().nullable().optional(),
    raw: z.string().optional(),
  })
  .loose();

/**
 * Thread — embeds messages array.
 *
 * Field → L2 consumer:
 *   id       → search thread grouping (messages.ts), modify expansion (messages.ts)
 *   messages → search thread depth (messages.ts), modify ID extraction (messages.ts)
 */
export const GmailThreadSchema = z
  .object({
    id: z.string().nullable().optional(),
    snippet: z.string().optional(),
    historyId: z.string().nullable().optional(),
    messages: z.array(GmailMessageSchema).optional(),
  })
  .loose();

/**
 * Draft — embeds a message. Works for both get() (full message) and list
 * items (minimal) because all fields are optional + passthrough.
 *
 * Field → L2 consumer:
 *   id      → getDrafts() draft_id (api/drafts.ts)
 *   message → getDrafts() header/body extraction (api/drafts.ts)
 */
export const GmailDraftSchema = z
  .object({
    id: z.string().nullable().optional(),
    message: GmailMessageSchema.optional(),
  })
  .loose();

/**
 * Label with counts, visibility, and color.
 *
 * Field → L2 consumer:
 *   id, name          → label-cache resolve/lookup
 *   type, visibility  → label overview grouping (api/labels.ts)
 *   counts            → label detail (api/labels.ts)
 *   color             → label detail (api/labels.ts)
 */
export const GmailLabelSchema = z
  .object({
    id: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    messageListVisibility: z.string().nullable().optional(),
    labelListVisibility: z.string().nullable().optional(),
    messagesTotal: z.number().nullable().optional(),
    messagesUnread: z.number().nullable().optional(),
    threadsTotal: z.number().nullable().optional(),
    threadsUnread: z.number().nullable().optional(),
    color: z
      .object({
        textColor: z.string().optional(),
        backgroundColor: z.string().optional(),
      })
      .loose()
      .nullable()
      .optional(),
  })
  .loose();

// ---------------------------------------------------------------------------
// List Envelopes (factory + per-resource)
// ---------------------------------------------------------------------------

/**
 * Factory for paginated list response schemas.
 * All Gmail list endpoints share the same envelope: items array + pagination.
 * @param itemSchema - The Zod schema for each item in the list
 * @param key - The response key containing the items array (e.g. 'messages', 'threads')
 * @returns A Zod schema validating the paginated envelope
 */
function listSchema<T extends z.ZodType>(itemSchema: T, key: string) {
  return z
    .object({
      [key]: z.array(itemSchema).optional(),
      nextPageToken: z.string().nullable().optional(),
      resultSizeEstimate: z.number().nullable().optional(),
    })
    .loose();
}

/** List items return minimal data — just IDs, not full item schemas. */
const MessageListItemSchema = z
  .object({
    id: z.string().nullable().optional(),
    threadId: z.string().nullable().optional(),
  })
  .loose();

const ThreadListItemSchema = z
  .object({
    id: z.string().nullable().optional(),
    snippet: z.string().optional(),
    historyId: z.string().nullable().optional(),
  })
  .loose();

/** Validates messages.list() response. */
export const GmailMessageListSchema = listSchema(MessageListItemSchema, 'messages');

/** Validates threads.list() response. */
export const GmailThreadListSchema = listSchema(ThreadListItemSchema, 'threads');

/** Validates drafts.list() response. Reuses GmailDraftSchema (all fields optional). */
export const GmailDraftListSchema = listSchema(GmailDraftSchema, 'drafts');

/** Validates labels.list() response. labels.list returns full label objects. */
export const GmailLabelListSchema = listSchema(GmailLabelSchema, 'labels');

/** History is unique — not a simple item list, has typed event sub-arrays. */
export const GmailHistoryListSchema = z
  .object({
    history: z
      .array(
        z
          .object({
            id: z.string().optional(),
            messages: z.array(GmailMessageSchema).optional(),
            messagesAdded: z.array(z.object({ message: GmailMessageSchema }).loose()).optional(),
            messagesDeleted: z.array(z.object({ message: GmailMessageSchema }).loose()).optional(),
            labelsAdded: z
              .array(
                z.object({ message: GmailMessageSchema, labelIds: z.array(z.string()) }).loose(),
              )
              .optional(),
            labelsRemoved: z
              .array(
                z.object({ message: GmailMessageSchema, labelIds: z.array(z.string()) }).loose(),
              )
              .optional(),
          })
          .loose(),
      )
      .optional(),
    nextPageToken: z.string().nullable().optional(),
    historyId: z.string().nullable().optional(),
  })
  .loose();

// ---------------------------------------------------------------------------
// Validation Helper
// ---------------------------------------------------------------------------

/**
 * Validate an API response against a Zod schema, wrapping ZodError into
 * GmailApiError for consistent error taxonomy. L1 always throws GmailApiError,
 * never raw ZodError — callers can rely on a single error type.
 * @param schema - The Zod schema to validate against
 * @param data - The raw API response data
 * @param operation - The operation label for error context
 */
export function validateResponse(schema: ZodType, data: unknown, operation: string): void {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new GmailApiError(operation, new Error(`Unexpected API response shape: ${details}`));
  }
}
