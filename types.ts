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

export const ContactSchema = z.object({
  name: z.string().nullable(),
  email: z.string(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const AttachmentInfoSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
});
export type AttachmentInfo = z.infer<typeof AttachmentInfoSchema>;

// ---------------------------------------------------------------------------
// Search / List Results
// ---------------------------------------------------------------------------

export const MessageSummarySchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  from: ContactSchema,
  to: z.array(ContactSchema),
  cc: z.array(ContactSchema),
  subject: z.string(),
  date: z.string(), // ISO 8601
  snippet: z.string(),
  labels: z.array(z.string()),
  is_unread: z.boolean(),
  is_starred: z.boolean(),
  has_attachments: z.boolean(),
  size_bytes: z.number(),
});
export type MessageSummary = z.infer<typeof MessageSummarySchema>;

export const SearchSummarySchema = z.object({
  unread_count: z.number(),
  senders: z.record(z.string(), z.number()),
  labels: z.record(z.string(), z.number()),
});
export type SearchSummary = z.infer<typeof SearchSummarySchema>;

export const SearchResultSchema = z.object({
  total_estimate: z.number(),
  returned: z.number(),
  next_page_token: z.string().nullable(),
  messages: z.array(MessageSummarySchema),
  summary: SearchSummarySchema,
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

// ---------------------------------------------------------------------------
// Full Message
// ---------------------------------------------------------------------------

export const FullMessageSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  from: ContactSchema,
  to: z.array(ContactSchema),
  cc: z.array(ContactSchema),
  bcc: z.array(ContactSchema),
  subject: z.string(),
  date: z.string(), // ISO 8601
  labels: z.array(z.string()),
  is_unread: z.boolean(),
  is_starred: z.boolean(),
  body_text: z.string(),
  body_html: z.string().nullable(),
  attachments: z.array(AttachmentInfoSchema),
  size_bytes: z.number(),
});
export type FullMessage = z.infer<typeof FullMessageSchema>;

// ---------------------------------------------------------------------------
// Full Thread
// ---------------------------------------------------------------------------

export const FullThreadSchema = z.object({
  id: z.string(),
  subject: z.string(),
  participants: z.array(ContactSchema),
  message_count: z.number(),
  messages: z.array(FullMessageSchema),
  labels: z.array(z.string()),
  has_unread: z.boolean(),
  date_range: z.object({
    first: z.string(),
    last: z.string(),
  }),
});
export type FullThread = z.infer<typeof FullThreadSchema>;

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

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
  visibility: z.string(),
});
export type LabelDetail = z.infer<typeof LabelDetailSchema>;

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
export type LabelOverview = z.infer<typeof LabelOverviewSchema>;

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

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
});
export type DraftDetail = z.infer<typeof DraftDetailSchema>;

export const DraftSummarySchema = z.object({
  total: z.number(),
  drafts: z.array(DraftDetailSchema),
});
export type DraftSummary = z.infer<typeof DraftSummarySchema>;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

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
export type FilterCriteria = z.infer<typeof FilterCriteriaSchema>;

export const FilterActionsSchema = z.object({
  add_labels: z.array(z.string()),
  remove_labels: z.array(z.string()),
  forward_to: z.string().nullable(),
  skip_inbox: z.boolean(),
  mark_read: z.boolean(),
});
export type FilterActions = z.infer<typeof FilterActionsSchema>;

export const FilterDetailSchema = z.object({
  id: z.string(),
  criteria: FilterCriteriaSchema,
  actions: FilterActionsSchema,
});
export type FilterDetail = z.infer<typeof FilterDetailSchema>;

export const FilterOverviewSchema = z.object({
  total: z.number(),
  filters: z.array(FilterDetailSchema),
});
export type FilterOverview = z.infer<typeof FilterOverviewSchema>;

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

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
      reply_to: z.string().nullable(),
    }),
  ),
  delegates: z.array(
    z.object({
      email: z.string(),
      status: z.string(),
    }),
  ),
  imap_enabled: z.boolean(),
  pop_enabled: z.boolean(),
});
export type AccountOverview = z.infer<typeof AccountOverviewSchema>;

// ---------------------------------------------------------------------------
// Write Operation Results
// ---------------------------------------------------------------------------

export const ModifyResultSchema = z.object({
  modified: z.number(),
  failed: z.array(z.string()),
});
export type ModifyResult = z.infer<typeof ModifyResultSchema>;

export const DeleteResultSchema = z.object({
  deleted: z.boolean(),
});
export type DeleteResult = z.infer<typeof DeleteResultSchema>;

export const SendResultSchema = z.object({
  message_id: z.string(),
});
export type SendResult = z.infer<typeof SendResultSchema>;

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export const GmailToolkitErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  operation: z.string(),
  retryable: z.boolean(),
});
export type GmailToolkitError = z.infer<typeof GmailToolkitErrorSchema>;
