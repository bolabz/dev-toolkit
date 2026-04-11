/**
 * Gmail Toolkit — Shared Type Definitions
 *
 * Zod schemas serve triple duty:
 *   1. Define TypeScript types (via z.infer)
 *   2. Validate API responses at runtime
 *   3. Generate MCP tool parameter schemas
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Zod schema for a named email contact. */
export const ContactSchema = z.object({
  name: z.string().nullable(),
  email: z.string(),
});
/** A named email contact with an optional display name and a required address. */
export type Contact = z.infer<typeof ContactSchema>;

/** Zod schema for attachment metadata returned alongside a message. */
export const AttachmentInfoSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
});
/** Metadata for a single email attachment (does not include the binary payload). */
export type AttachmentInfo = z.infer<typeof AttachmentInfoSchema>;

// ---------------------------------------------------------------------------
// Search / List Results
// ---------------------------------------------------------------------------

/** Zod schema for a lightweight message row returned in search/list results. */
export const MessageSummarySchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  from: ContactSchema,
  to: z.array(ContactSchema),
  cc: z.array(ContactSchema),
  subject: z.string(),
  date: z.string(), // ISO 8601 — derived from internalDate (Gmail receipt time, not sender Date header)
  snippet: z.string(),
  labels: z.array(z.string()),
  is_unread: z.boolean(),
  is_starred: z.boolean(),
  is_mailing_list: z.boolean(),
  has_attachments: z.boolean(),
  reply_to: ContactSchema.nullable(),
  size_bytes: z.number(),
  history_id: z.string(),
  web_url: z.string(),
  body_text: z.string().nullable().optional(),
});
/**
 * Lightweight message representation included in search results.
 * Contains headers, labels, and optional processed body text but omits raw MIME parts.
 */
export type MessageSummary = z.infer<typeof MessageSummarySchema>;

/** Zod schema for aggregate analytics derived from a search result set. */
export const SearchSummarySchema = z.object({
  unread_count: z.number(),
  senders: z.record(z.string(), z.number()),
  labels: z.record(z.string(), z.number()),
});
/**
 * Aggregate analytics computed from a set of search results:
 * unread count, sender frequency map, and label frequency map.
 */
export type SearchSummary = z.infer<typeof SearchSummarySchema>;

/** Zod schema for a complete paginated message search result. */
export const SearchResultSchema = z.object({
  total_estimate: z.number(),
  returned: z.number(),
  next_page_token: z.string().nullable(),
  messages: z.array(MessageSummarySchema),
  summary: SearchSummarySchema,
});
/** Complete paginated search result: message rows, paging token, and summary analytics. */
export type SearchResult = z.infer<typeof SearchResultSchema>;

// ---------------------------------------------------------------------------
// Full Message
// ---------------------------------------------------------------------------

/** Zod schema for a fully hydrated message with processed body text. */
export const FullMessageSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  from: ContactSchema,
  to: z.array(ContactSchema),
  cc: z.array(ContactSchema),
  bcc: z.array(ContactSchema),
  reply_to: ContactSchema.nullable(),
  subject: z.string(),
  date: z.string(), // ISO 8601 — derived from internalDate (Gmail receipt time, not sender Date header)
  labels: z.array(z.string()),
  is_unread: z.boolean(),
  is_starred: z.boolean(),
  is_mailing_list: z.boolean(),
  body_text: z.string(),
  body_html: z.string().nullable(),
  attachments: z.array(AttachmentInfoSchema),
  size_bytes: z.number(),
  history_id: z.string(),
  web_url: z.string(),
});
/**
 * Complete message with all headers, processed plain-text and HTML body,
 * attachment metadata, and resolved label names.
 */
export type FullMessage = z.infer<typeof FullMessageSchema>;

// ---------------------------------------------------------------------------
// Full Thread
// ---------------------------------------------------------------------------

/** Zod schema for per-label counts attached to a thread. */
const LabelContextSchema = z.object({
  name: z.string(),
  messages_total: z.number(),
  messages_unread: z.number(),
});

/** Zod schema for a fully hydrated email thread including all messages. */
export const FullThreadSchema = z.object({
  id: z.string(),
  subject: z.string(),
  participants: z.array(ContactSchema),
  message_count: z.number(),
  messages: z.array(FullMessageSchema),
  labels: z.array(z.string()),
  label_context: z.array(LabelContextSchema).optional(),
  has_unread: z.boolean(),
  date_range: z.object({
    first: z.string(),
    last: z.string(),
  }),
});
/**
 * Full email thread with all messages in chronological order, resolved label names,
 * participant list, and optional per-label message counts.
 */
export type FullThread = z.infer<typeof FullThreadSchema>;

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Zod schema for a fully resolved label definition including message counts and color. */
export const LabelDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['system', 'user']),
  messages_total: z.number(),
  messages_unread: z.number(),
  threads_total: z.number(),
  threads_unread: z.number(),
  color: z
    .object({
      text: z.string(),
      background: z.string(),
    })
    .nullable(),
  label_list_visibility: z.string(),
  message_list_visibility: z.string(),
});
/** Complete label definition including message/thread counts, color, and visibility settings. */
export type LabelDetail = z.infer<typeof LabelDetailSchema>;

/** Zod schema for the full label overview grouped by type with summary statistics. */
export const LabelOverviewSchema = z.object({
  system_labels: z.array(LabelDetailSchema),
  user_labels: z.array(LabelDetailSchema),
  categories: z.array(LabelDetailSchema),
  summary: z.object({
    total_user_labels: z.number(),
    empty_labels: z.array(z.string()),
    most_active: z.string(),
  }),
});
/**
 * Full label listing grouped into system labels, user labels, and categories,
 * with a summary of usage statistics.
 */
export type LabelOverview = z.infer<typeof LabelOverviewSchema>;

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

/** Zod schema for a single draft with headers and optional body. */
export const DraftDetailSchema = z.object({
  draft_id: z.string(),
  message_id: z.string(),
  thread_id: z.string().nullable(),
  to: z.array(ContactSchema),
  cc: z.array(ContactSchema),
  subject: z.string().nullable(),
  snippet: z.string(),
  date: z.string(),
  size_bytes: z.number(),
  has_attachments: z.boolean(),
  body_text: z.string().nullable().optional(),
});
/** Metadata for a single draft message including headers, snippet, and optional processed body. */
export type DraftDetail = z.infer<typeof DraftDetailSchema>;

/** Zod schema for a paginated draft listing with total count. */
export const DraftSummarySchema = z.object({
  total: z.number(),
  drafts: z.array(DraftDetailSchema),
});
/** Paginated collection of drafts with total count and per-draft metadata. */
export type DraftSummary = z.infer<typeof DraftSummarySchema>;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Zod schema for Gmail filter match criteria. */
export const FilterCriteriaSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  subject: z.string().nullable(),
  query: z.string().nullable(),
  negated_query: z.string().nullable(),
  has_attachment: z.boolean().nullable(),
  size: z.number().nullable(),
  size_comparison: z.enum(['smaller', 'larger']).nullable(),
});
/**
 * Criteria that determine which incoming messages a Gmail filter matches
 * (sender, recipient, subject, query, size, attachment presence, etc.).
 */
export type FilterCriteria = z.infer<typeof FilterCriteriaSchema>;

/** Zod schema for the actions applied when a Gmail filter matches a message. */
export const FilterActionsSchema = z.object({
  add_labels: z.array(z.string()),
  remove_labels: z.array(z.string()),
  forward_to: z.string().nullable(),
  skip_inbox: z.boolean(),
  mark_read: z.boolean(),
});
/**
 * Actions applied to a message when a Gmail filter matches:
 * label mutations, forwarding address, skip-inbox, and mark-as-read.
 */
export type FilterActions = z.infer<typeof FilterActionsSchema>;

/** Zod schema for a complete Gmail filter with criteria and actions. */
export const FilterDetailSchema = z.object({
  id: z.string(),
  criteria: FilterCriteriaSchema,
  actions: FilterActionsSchema,
});
/** Complete Gmail filter definition pairing a filter ID with its criteria and actions. */
export type FilterDetail = z.infer<typeof FilterDetailSchema>;

/** Zod schema for the full collection of Gmail filters with total count. */
export const FilterOverviewSchema = z.object({
  total: z.number(),
  filters: z.array(FilterDetailSchema),
});
/** All Gmail filters with a total count and per-filter details. */
export type FilterOverview = z.infer<typeof FilterOverviewSchema>;

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

/** Zod schema for the Gmail account overview aggregating profile and settings data. */
export const AccountOverviewSchema = z.object({
  email: z.string(),
  messages_total: z.number(),
  threads_total: z.number(),
  history_id: z.string(),
  vacation: z.object({
    enabled: z.boolean(),
    subject: z.string().nullable(),
    start: z.string().nullable(),
    end: z.string().nullable(),
    restrict_to_contacts: z.boolean(),
  }),
  forwarding: z.object({
    enabled: z.boolean(),
    email: z.string().nullable(),
    disposition: z.string().nullable(),
  }),
  forwarding_addresses: z.array(
    z.object({
      email: z.string(),
      verified: z.boolean(),
    }),
  ),
  send_as_aliases: z.array(
    z.object({
      email: z.string(),
      display_name: z.string(),
      is_default: z.boolean(),
      is_primary: z.boolean(),
      reply_to: z.string().nullable(),
      signature_html: z.string().nullable(),
      signature_text: z.string().nullable(),
    }),
  ),
  delegates: z.array(
    z.object({
      email: z.string(),
      status: z.string(),
    }),
  ),
  imap: z.object({
    enabled: z.boolean(),
    auto_expunge: z.boolean(),
    expunge_behavior: z.string(),
  }),
  pop: z.object({
    enabled: z.boolean(),
    access_window: z.string(),
    disposition: z.string(),
  }),
});
/**
 * Gmail account overview: profile counters, vacation responder, forwarding,
 * send-as aliases, delegates, and IMAP/POP status.
 */
export type AccountOverview = z.infer<typeof AccountOverviewSchema>;

// ---------------------------------------------------------------------------
// Write Operation Results
// ---------------------------------------------------------------------------

/** Zod schema for the result of a batch label-modification operation. */
export const ModifyResultSchema = z.object({
  modified: z.number(),
  failed: z.array(z.string()),
  message: z.string(),
});
/** Result of a batch label-modification: count of modified messages and any failure IDs. */
export type ModifyResult = z.infer<typeof ModifyResultSchema>;

/** Zod schema for the result of a single message delete or trash operation. */
export const DeleteResultSchema = z.object({
  deleted: z.boolean(),
  message: z.string(),
});
/** Result of a single message delete or trash operation with a human-readable summary. */
export type DeleteResult = z.infer<typeof DeleteResultSchema>;

/** Zod schema for the result of deleting a label including affected message/thread counts. */
export const DeleteLabelResultSchema = z.object({
  deleted: z.boolean(),
  label_name: z.string(),
  label_id: z.string(),
  messages_affected: z.number(),
  threads_affected: z.number(),
  message: z.string(),
});
/**
 * Result of deleting a user label: confirmation flag, label details, and counts of
 * messages and threads that had the label removed.
 */
export type DeleteLabelResult = z.infer<typeof DeleteLabelResultSchema>;

/** Zod schema for the result of deleting a Gmail filter rule. */
export const DeleteFilterResultSchema = z.object({
  deleted: z.boolean(),
  filter_id: z.string(),
  criteria_summary: z.string(),
  message: z.string(),
});
/**
 * Result of deleting a Gmail filter: confirmation flag, filter ID, and a
 * human-readable summary of the criteria that were removed.
 */
export type DeleteFilterResult = z.infer<typeof DeleteFilterResultSchema>;

/** Zod schema for the result of sending a message or draft. */
export const SendResultSchema = z.object({
  message_id: z.string(),
  thread_id: z.string().nullable(),
  message: z.string(),
});
/**
 * Result of sending a message or draft: assigned message ID, thread ID, and a
 * human-readable confirmation.
 */
export type SendResult = z.infer<typeof SendResultSchema>;

// ---------------------------------------------------------------------------
// Thread Search
// ---------------------------------------------------------------------------

/** Zod schema for a lightweight thread row returned in thread search results. */
export const ThreadSummarySchema = z.object({
  id: z.string(),
  snippet: z.string(),
  history_id: z.string(),
});
/** Lightweight thread row from a search — use readThread() to fetch full details. */
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

/** Zod schema for a paginated thread search result. */
export const ThreadSearchResultSchema = z.object({
  total_estimate: z.number(),
  returned: z.number(),
  next_page_token: z.string().nullable(),
  threads: z.array(ThreadSummarySchema),
});
/** Paginated thread search result with lightweight thread rows and paging metadata. */
export type ThreadSearchResult = z.infer<typeof ThreadSearchResultSchema>;

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** Zod schema for a single mailbox change event from the history API. */
export const HistoryEventSchema = z.object({
  history_id: z.string(),
  message_id: z.string().nullable(),
  type: z.enum(['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']),
  label_ids: z.array(z.string()),
});
/** A single mailbox change event: what happened, to which message, and which labels changed. */
export type HistoryEvent = z.infer<typeof HistoryEventSchema>;

/** Zod schema for the result of polling mailbox history since a given history ID. */
export const HistoryResultSchema = z.object({
  current_history_id: z.string(),
  next_page_token: z.string().nullable(),
  events: z.array(HistoryEventSchema),
});
/** Incremental sync result: change events since the requested history ID and the new watermark. */
export type HistoryResult = z.infer<typeof HistoryResultSchema>;

// ---------------------------------------------------------------------------
// Error (MCP response DTO)
// ---------------------------------------------------------------------------

/**
 * Zod schema for the serialised error DTO returned by MCP tool handlers.
 * Tool handlers catch `GmailApiError` / `GmailValidationError` from Layers 1–2
 * and populate this schema before returning `{ content, isError: true }`.
 * Not thrown directly — see `src/errors.ts` for the thrown error classes.
 */
export const GmailToolkitErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  operation: z.string(),
  retryable: z.boolean(),
  field: z.string().optional(),
});
/**
 * Serialised error DTO returned inside MCP tool results when an operation fails.
 * Carries HTTP status code, message, operation label, retryability flag, and optional field name.
 */
export type GmailToolkitError = z.infer<typeof GmailToolkitErrorSchema>;
