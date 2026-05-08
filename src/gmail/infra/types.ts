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

/**
 * Compact date range for a thread or conversation.
 * `last` is omitted when the thread contains a single message (first === last),
 * saving ~24 bytes per thread in large result sets.
 */
export const DateRangeSchema = z.object({
  first: z.string(),
  /** Absent when the thread has only one message (first === last). */
  last: z.string().optional(),
});
/** Thread date range: first-message date, and last-message date when the thread has multiple messages. */
export type DateRange = z.infer<typeof DateRangeSchema>;

// ---------------------------------------------------------------------------
// Search / List Results
// ---------------------------------------------------------------------------

/** Zod schema for a lightweight message row returned in search/list results. */
export const MessageSummarySchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  from: ContactSchema,
  to: z.array(ContactSchema),
  /** Absent (not serialized) when the message has no CC recipients. */
  cc: z.array(ContactSchema).optional(),
  subject: z.string(),
  date: z.string(), // ISO 8601 — derived from internalDate (Gmail receipt time, not sender Date header)
  snippet: z.string(),
  labels: z.array(z.string()),
  is_unread: z.boolean(),
  is_starred: z.boolean(),
  is_mailing_list: z.boolean(),
  has_attachments: z.boolean(),
  /** Absent (not serialized) when the message has no Reply-To header. */
  reply_to: ContactSchema.optional(),
  size_bytes: z.number(),
  /** Absent (not serialized) when body was not requested (includeBody=false). */
  body_text: z.string().optional(),
  // Note: history_id and web_url are intentionally omitted from list results.
  // web_url is derivable: `https://mail.google.com/mail/u/0/#all/${id}`
  // history_id is a sync primitive — available on FullMessage for incremental sync use cases.
});
/** Compact message summary for list/search responses. */
export type MessageSummary = z.infer<typeof MessageSummarySchema>;

/**
 * Zod schema for a message nested inside a ThreadMatch result.
 * Omits `subject` and `thread_id` — both are already present on the parent thread,
 * so repeating them on every matched message is pure redundancy.
 */
export const MatchedMessageSummarySchema = MessageSummarySchema.omit({
  subject: true,
  thread_id: true,
});
/** Message summary nested within a ThreadMatch — omits subject/thread_id (carried on thread). */
export type MatchedMessageSummary = z.infer<typeof MatchedMessageSummarySchema>;

/** Zod schema for aggregate analytics derived from a search result set. */
export const SearchSummarySchema = z.object({
  unread_count: z.number(),
  senders: z.array(z.object({ name: z.string().nullable(), email: z.string(), count: z.number() })),
  labels: z.record(z.string(), z.number()),
  thread_depth: z.object({
    single_message: z.number(),
    multi_message: z.number(),
    deepest: z.object({ thread_id: z.string(), count: z.number() }).optional(),
  }),

  // Enriched aggregations (zero additional API cost)
  domains: z
    .array(z.object({ domain: z.string(), count: z.number(), senders: z.number() }))
    .optional(),
  categories: z.record(z.string(), z.number()).optional(),
  read_rate_by_sender: z
    .array(z.object({ email: z.string(), total: z.number(), read_pct: z.number() }))
    .optional(),
  size_stats: z
    .object({
      total_bytes: z.number(),
      avg_bytes: z.number(),
      p50_bytes: z.number(),
      p95_bytes: z.number(),
      largest: z.object({ message_id: z.string(), size_bytes: z.number() }),
    })
    .optional(),
  attachment_count: z.number().optional(),
  starred_count: z.number().optional(),
  important_count: z.number().optional(),
  mailing_list_count: z.number().optional(),
  date_histogram: z.array(z.object({ period: z.string(), count: z.number() })).optional(),
});
/** Aggregated analytics over a search result (unread counts, senders, labels, thread depth). */
export type SearchSummary = z.infer<typeof SearchSummarySchema>;

/** Zod schema for a complete paginated message search result. */
export const SearchResultSchema = z.object({
  total_estimate: z.number(),
  returned: z.number(),
  next_page_token: z.string().nullable(),
  messages: z.array(MessageSummarySchema),
  summary: SearchSummarySchema,
  related_queries: z.array(z.string()),
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
  /** Absent when the message has no CC recipients. */
  cc: z.array(ContactSchema).optional(),
  /** Absent when the message has no BCC recipients. */
  bcc: z.array(ContactSchema).optional(),
  reply_to: ContactSchema.nullable(),
  subject: z.string(),
  date: z.string(), // ISO 8601 — derived from internalDate (Gmail receipt time, not sender Date header)
  labels: z.array(z.string()),
  is_unread: z.boolean(),
  is_starred: z.boolean(),
  is_mailing_list: z.boolean(),
  body_text: z.string(),
  body_html: z.string().nullable(),
  /** Absent when the message has no attachments. */
  attachments: z.array(AttachmentInfoSchema).optional(),
  size_bytes: z.number(),
  /** History ID for incremental sync. Absent when unavailable. */
  history_id: z.string().optional(),
  web_url: z.string(),
});
/** Fully resolved message with parsed contacts, labels, body text, and attachment metadata. */
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
  date_range: DateRangeSchema,
});
/** Complete thread with all messages, participants, and date range. */
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
/** All labels grouped by type (system, user) with counts and summaries. */
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

/** Zod schema for a complete draft listing with total count. */
export const DraftSummarySchema = z.object({
  total: z.number(),
  drafts: z.array(DraftDetailSchema),
});
/** Collection of all drafts with total count and per-draft metadata. */
export type DraftSummary = z.infer<typeof DraftSummarySchema>;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Zod schema for Gmail filter match criteria (output shape — only set fields are present). */
export const FilterCriteriaSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  subject: z.string().optional(),
  query: z.string().optional(),
  negated_query: z.string().optional(),
  has_attachment: z.boolean().optional(),
  size: z.number().optional(),
  size_comparison: z.enum(['smaller', 'larger']).optional(),
});
/**
 * Criteria that determine which incoming messages a Gmail filter matches
 * (sender, recipient, subject, query, size, attachment presence, etc.).
 * Only set fields are present — unused criteria are omitted rather than null.
 */
export type FilterCriteria = z.infer<typeof FilterCriteriaSchema>;

/** Zod schema for filter criteria input params (infra by search, create filter, and modify). */
export const FilterCriteriaInputSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  subject: z.string().optional(),
  query: z.string().optional(),
  negated_query: z.string().optional(),
  has_attachment: z.boolean().optional(),
  size: z.number().optional(),
  size_comparison: z.enum(['smaller', 'larger']).optional(),
});
/** Input criteria for searching, filtering, or modifying messages by structured fields. */
export type FilterCriteriaInput = z.infer<typeof FilterCriteriaInputSchema>;

/**
 * Zod schema for search criteria — extends filter criteria with search-only fields
 * (dates, label, status, filter_id) that are not valid for Gmail filter creation.
 */
export const SearchCriteriaInputSchema = FilterCriteriaInputSchema.extend({
  after: z.string().optional(),
  before: z.string().optional(),
  labels: z.array(z.string()).optional(),
  exclude_labels: z.array(z.string()).optional(),
  is: z.enum(['unread', 'read', 'starred', 'important', 'snoozed']).optional(),
  filter_id: z.string().optional(),
});
/** Search criteria extending filter criteria with date ranges, label filters, and status. */
export type SearchCriteriaInput = z.infer<typeof SearchCriteriaInputSchema>;

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
  forwarding_addresses: z.array(z.object({ email: z.string(), verified: z.boolean() })),
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
  delegates: z.array(z.object({ email: z.string(), status: z.string() })),
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

/** Zod schema for the full account context combining profile, labels, and filters. */
export const AccountContextSchema = AccountOverviewSchema.extend({
  labels: LabelOverviewSchema,
  filters: FilterOverviewSchema,
});
/**
 * Full account context: profile + settings + all labels + all filters.
 * Returned by the unified `gmail_account` MCP tool for one-call orientation.
 */
export type AccountContext = z.infer<typeof AccountContextSchema>;

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
/** Result of deleting a filter rule, including the resolved criteria summary. */
export type DeleteFilterResult = z.infer<typeof DeleteFilterResultSchema>;

/** Zod schema for the result of sending a message or draft. */
export const SendResultSchema = z.object({
  message_id: z.string(),
  thread_id: z.string().nullable(),
  message: z.string(),
});
/** Result of sending a message or draft (returns the sent message ID + thread ID). */
export type SendResult = z.infer<typeof SendResultSchema>;

// ---------------------------------------------------------------------------
// Compose Mode (discriminated union for unified compose operations)
// ---------------------------------------------------------------------------

const ComposeCommonFields = {
  cc: z.string().optional(),
  bcc: z.string().optional(),
  content_type: z.enum(['text/plain', 'text/html']).optional(),
  thread_id: z.string().optional(),
};

const ComposeDraftSchema = z.object({
  mode: z.literal('draft'),
  body: z.string(),
  to: z.string().optional(),
  subject: z.string().optional(),
  ...ComposeCommonFields,
});

const ComposeUpdateDraftSchema = z.object({
  mode: z.literal('update_draft'),
  draft_id: z.string(),
  body: z.string(),
  to: z.string().optional(),
  subject: z.string().optional(),
  ...ComposeCommonFields,
});

const ComposeSendSchema = z.object({
  mode: z.literal('send'),
  to: z.string(),
  subject: z.string(),
  body: z.string(),
  ...ComposeCommonFields,
});

const ComposeSendDraftSchema = z.object({
  mode: z.literal('send_draft'),
  draft_id: z.string(),
});

/** Discriminated union for all compose operations: draft, update_draft, send, send_draft. */
export const ComposeModeSchema = z.discriminatedUnion('mode', [
  ComposeDraftSchema,
  ComposeUpdateDraftSchema,
  ComposeSendSchema,
  ComposeSendDraftSchema,
]);
/** Discriminated union: draft | update_draft | send | send_draft. */
export type ComposeMode = z.infer<typeof ComposeModeSchema>;

// ---------------------------------------------------------------------------
// Thread Search
// ---------------------------------------------------------------------------

/** Zod schema for a lightweight thread row returned in thread search results. */
export const ThreadSummarySchema = z.object({
  id: z.string(),
  snippet: z.string(),
  history_id: z.string(),
  // Enrichment fields (present only when enrich=true)
  message_count: z.number().optional(),
  subject: z.string().optional(),
  participants: z.array(ContactSchema).optional(),
  has_unread: z.boolean().optional(),
  date_range: DateRangeSchema.optional(),
});
/** Lightweight thread row from a search — use readThread() for full details. Enrichment fields present when enrich=true. */
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
  events: z.array(HistoryEventSchema),
});
/** Incremental sync result: all change events since the requested history ID and the new watermark. */
export type HistoryResult = z.infer<typeof HistoryResultSchema>;

// ---------------------------------------------------------------------------
// Aggregated Search
// ---------------------------------------------------------------------------

/** Zod schema for a thread containing matched messages from an aggregated search. */
export const ThreadMatchSchema = z.object({
  id: z.string(),
  subject: z.string(),
  message_count: z.number(),
  matched_count: z.number(),
  participants: z.array(ContactSchema),
  has_unread: z.boolean(),
  date_range: DateRangeSchema,
  matched_messages: z.array(MatchedMessageSummarySchema),
});
/** A thread with its matched messages from an aggregated search. */
export type ThreadMatch = z.infer<typeof ThreadMatchSchema>;

/** Zod schema for the complete result of an aggregated (all-pages) search. */
export const SearchAllResultSchema = z.object({
  total_messages: z.number(),
  total_threads: z.number(),
  threads: z.array(ThreadMatchSchema),
  summary: SearchSummarySchema,
});
/** Complete aggregated search result: messages grouped by thread with analytics. */
export type SearchAllResult = z.infer<typeof SearchAllResultSchema>;

// ---------------------------------------------------------------------------
// Message with Context
// ---------------------------------------------------------------------------

/** Zod schema for a message entry within a ReadThread (position + full message). */
export const ReadMessageEntrySchema = z.object({
  position: z.number(),
  message: FullMessageSchema,
});
/** Zod schema for a thread in the read() result — context once, messages nested. */
export const ReadThreadSchema = z.object({
  id: z.string(),
  subject: z.string(),
  message_count: z.number(),
  participants: z.array(ContactSchema),
  has_unread: z.boolean(),
  date_range: DateRangeSchema,
  messages: z.array(ReadMessageEntrySchema),
});
/** A thread with context emitted once and messages nested underneath. */
export type ReadThread = z.infer<typeof ReadThreadSchema>;

/** Zod schema for the read() result — threads with deduplicated context. */
export const ReadResultSchema = z.array(ReadThreadSchema);
/** Array of threads, each with context emitted once and messages nested. */
export type ReadResult = z.infer<typeof ReadResultSchema>;

// ---------------------------------------------------------------------------
// Error (MCP response DTO)
// ---------------------------------------------------------------------------

/** Zod schema for the serialised error DTO returned by MCP tool handlers. */
export const GmailToolkitErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  operation: z.string(),
  retryable: z.boolean(),
  field: z.string().optional(),
  recovery: z
    .object({
      strategy: z.string(),
      suggestion: z.string(),
      retry_after_seconds: z.number().optional(),
    })
    .optional(),
});
/**
 * Serialised error DTO returned inside MCP tool results when an operation fails.
 * Carries HTTP status code, message, operation label, retryability flag, and optional field name.
 */
export type GmailToolkitError = z.infer<typeof GmailToolkitErrorSchema>;
/** Recovery advice extracted from a GmailToolkitError. */
type Recovery = NonNullable<GmailToolkitError['recovery']>;

export type { Recovery };
