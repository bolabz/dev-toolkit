# Gmail Toolkit — Implementation Spec v3

**For:** Claude Code CLI
**Project:** `~/path-to/gmail-toolkit` (WebStorm project)
**Date:** April 8, 2026

Read this entire document before making any changes. Each task includes the exact files, functions, and logic to modify. Build after each major task to catch errors incrementally.

---

## Task 1: Fix `has_attachments` Detection Bug

**Problem:** `has_attachments` returns `false` for emails with nested MIME attachments. The current check in `src/composed/search.ts` (line 124–132) and `src/composed/drafts.ts` (line 120–126) only checks for `body.attachmentId`, but some attachments are encoded as parts with `Content-Disposition: attachment` without an explicit `attachmentId` at the metadata level. Additionally, the metadata format (`messages.batchGet` with `format: 'metadata'`) doesn't include full part trees — it only includes the top-level MIME structure.

**Fix in `src/composed/search.ts`:**

Replace the `hasAttachments` function (lines 124–132) with a version that also checks for:

1. Parts with a non-empty `filename` (even without `attachmentId` — metadata format may omit it)
2. Parts with `Content-Disposition: attachment` in headers
3. As a fallback heuristic: if `sizeEstimate` is large (>100KB) and the message has multipart structure with parts beyond text/plain and text/html, flag as likely having attachments

```typescript
function hasAttachments(payload: gmail_v1.Schema$MessagePart | undefined): boolean {
  if (!payload) return false;

  function walk(part: gmail_v1.Schema$MessagePart): boolean {
    // Has explicit attachment ID
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      return true;
    }
    // Has a filename but no attachmentId (metadata format limitation)
    if (
      part.filename &&
      part.filename.length > 0 &&
      part.mimeType !== 'text/plain' &&
      part.mimeType !== 'text/html'
    ) {
      return true;
    }
    // Check Content-Disposition header
    const disposition = (part.headers ?? []).find(
      (h) => h.name?.toLowerCase() === 'content-disposition',
    );
    if (disposition?.value?.toLowerCase().startsWith('attachment')) {
      return true;
    }
    return (part.parts ?? []).some((p) => walk(p));
  }

  return walk(payload);
}
```

**Also fix in `src/composed/drafts.ts`:** Same logic for the `hasAttachments` function (lines 120–126). Replace with identical recursive walk.

**Also fix in `src/composed/readers.ts`:** The `extractAttachments` function (line 134–154) already does a recursive walk, which is good. But verify it also catches the `filename`-without-`attachmentId` case. Currently it requires both `part.filename && part.body?.attachmentId` (line 139). Relax to:

```typescript
if (part.filename && part.filename.length > 0) {
  attachments.push({
    id: part.body?.attachmentId ?? '',
    filename: part.filename,
    mime_type: part.mimeType ?? 'application/octet-stream',
    size_bytes: part.body?.size ?? 0,
  });
}
```

This way, attachments without an `attachmentId` (e.g., inline images) are still detected. The `id` being empty signals to downstream code that this attachment can't be downloaded individually, but it's still present.

---

## Task 2: Add `include_body` Option to `gmail_search`

**Goal:** Eliminate the search → read round-trip. When `include_body` is `true`, search fetches messages in `full` format and runs body processing inline, returning a `body_text` field on each result.

### 2a. Update `SearchResult` types in `src/types.ts`

Add an optional `body_text` field to `MessageSummarySchema`:

```typescript
export const MessageSummarySchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  from: ContactSchema,
  to: z.array(ContactSchema),
  cc: z.array(ContactSchema),
  subject: z.string(),
  date: z.string(),
  snippet: z.string(),
  labels: z.array(z.string()),
  is_unread: z.boolean(),
  is_starred: z.boolean(),
  has_attachments: z.boolean(),
  size_bytes: z.number(),
  body_text: z.string().nullable().optional(), // <-- ADD THIS
});
```

### 2b. Update `src/composed/search.ts`

Add `includeBody` parameter to the `search` function signature:

```typescript
export async function search(
  client: GmailClient,
  labelCache: LabelCache,
  query: string,
  maxResults = 20,
  pageToken?: string,
  includeBody = false,  // <-- ADD THIS
): Promise<SearchResult> {
```

Change the `batchGet` call to use `'full'` format when `includeBody` is true:

```typescript
const format = includeBody ? 'full' : 'metadata';
const headers = includeBody ? undefined : METADATA_HEADERS;
const rawMessages = await client.messages.batchGet(ids, format, headers);
```

In the `for (const raw of rawMessages)` loop, after constructing the `MessageSummary`, add body processing when `includeBody` is true:

```typescript
let bodyText: string | null = null;
if (includeBody) {
  const { text } = await processMessagePayload(
    raw.payload ?? {},
    raw.payload?.mimeType ?? undefined,
    { stripReplies: true, includeHtml: false },
  );
  bodyText = text;
}

messages.push({
  // ... existing fields ...
  body_text: bodyText,
});
```

Add the import at the top of the file:

```typescript
import { processMessagePayload } from './body-processing.js';
```

### 2c. Update MCP tool registration in `src/mcp-server.ts`

For the `gmail_search` tool, add the `include_body` parameter:

```typescript
if (isEnabled('gmail_search')) {
  server.tool(
    'gmail_search',
    toolRegistry.gmail_search.description,
    {
      query: z.string().describe('Gmail search query (e.g., "is:unread from:chase")'),
      max_results: z.number().optional().describe('Max messages to return (default 20)'),
      page_token: z.string().optional().describe('Pagination token from previous search'),
      include_body: z
        .boolean()
        .optional()
        .describe(
          'Include processed body text per message (default false). Eliminates need for separate read calls.',
        ),
    },
    async ({ query, max_results, page_token, include_body }) => {
      const result = await search(client, labelCache, query, max_results, page_token, include_body);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
```

### 2d. Update library class in `src/index.ts`

Update the `search` method signature:

```typescript
async search(query: string, maxResults?: number, pageToken?: string, includeBody?: boolean): Promise<SearchResult> {
  return search(this.client, this.labelCache, query, maxResults, pageToken, includeBody);
}
```

### 2e. Update tool description in `src/config/tools.ts`

```typescript
gmail_search: {
  enabled: true,
  category: 'read' as const,
  description: 'Search messages by Gmail query. Set include_body=true to get processed body text inline (eliminates separate read calls).',
},
```

---

## Task 3: Add `label_context` to Thread Reads

**Goal:** When reading a thread, embed lightweight label counts so the LLM doesn't need a follow-up `get_labels` call to understand label significance.

### 3a. Add `LabelContext` to types in `src/types.ts`

Add a new schema and embed it in `FullThreadSchema`:

```typescript
export const LabelContextSchema = z.object({
  name: z.string(),
  messages_total: z.number(),
  messages_unread: z.number(),
});
export type LabelContext = z.infer<typeof LabelContextSchema>;
```

Add to `FullThreadSchema`:

```typescript
export const FullThreadSchema = z.object({
  id: z.string(),
  subject: z.string(),
  participants: z.array(ContactSchema),
  message_count: z.number(),
  messages: z.array(FullMessageSchema),
  labels: z.array(z.string()),
  label_context: z.array(LabelContextSchema).optional(), // <-- ADD THIS
  has_unread: z.boolean(),
  date_range: z.object({
    first: z.string(),
    last: z.string(),
  }),
});
```

### 3b. Update `src/composed/readers.ts` — `readThread` function

After collecting all labels, batch-fetch the user labels that appear on this thread to get their counts:

```typescript
export async function readThread(
  client: GmailClient,
  labelCache: LabelCache,
  threadId: string,
  includeLabelContext = true, // <-- ADD THIS PARAM
): Promise<FullThread> {
  const raw = await client.threads.get(threadId, 'full');
  const rawMessages = raw.messages ?? [];

  const messages: FullMessage[] = [];
  const allParticipants: Contact[] = [];
  const allLabels = new Set<string>();
  const allLabelIds = new Set<string>();
  let hasUnread = false;

  for (const msg of rawMessages) {
    // Collect raw label IDs before resolution
    for (const lid of msg.labelIds ?? []) {
      allLabelIds.add(lid);
    }

    const transformed = await transformMessage(msg, labelCache, {
      stripReplies: false,
      includeHtml: false,
    });
    messages.push(transformed);

    allParticipants.push(transformed.from, ...transformed.to, ...transformed.cc);
    transformed.labels.forEach((l) => allLabels.add(l));
    if (transformed.is_unread) hasUnread = true;
  }

  // Build label context: fetch counts for user labels on this thread
  let labelContext:
    | Array<{ name: string; messages_total: number; messages_unread: number }>
    | undefined;
  if (includeLabelContext) {
    const userLabelIds = Array.from(allLabelIds).filter(
      (id) => !id.startsWith('CATEGORY_') && !isSystemLabel(id),
    );
    if (userLabelIds.length > 0) {
      try {
        const detailed = await client.labels.batchGet(userLabelIds);
        labelContext = detailed.map((l) => ({
          name: l.name ?? l.id ?? '',
          messages_total: l.messagesTotal ?? 0,
          messages_unread: l.messagesUnread ?? 0,
        }));
      } catch {
        // Non-fatal — omit label context
      }
    }
  }

  const firstDate = messages[0]?.date ?? '';
  const lastDate = messages[messages.length - 1]?.date ?? '';

  return {
    id: raw.id ?? '',
    subject: messages[0]?.subject ?? '(no subject)',
    participants: deduplicateContacts(allParticipants),
    message_count: messages.length,
    messages,
    labels: Array.from(allLabels),
    label_context: labelContext,
    has_unread: hasUnread,
    date_range: {
      first: firstDate,
      last: lastDate,
    },
  };
}
```

Add a helper function at the bottom of the file:

```typescript
const SYSTEM_LABEL_IDS = new Set([
  'INBOX',
  'SENT',
  'DRAFT',
  'SPAM',
  'TRASH',
  'UNREAD',
  'STARRED',
  'IMPORTANT',
  'CHAT',
  'CATEGORY_PERSONAL',
  'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
]);

function isSystemLabel(id: string): boolean {
  return SYSTEM_LABEL_IDS.has(id);
}
```

---

## Task 4: Enrich Delete Responses for Labels and Filters

**Goal:** `deleteLabel` and `deleteFilter` should return meaningful context about what was deleted, not just `{ deleted: true }`.

### 4a. Add new result schemas to `src/types.ts`

```typescript
export const DeleteLabelResultSchema = z.object({
  deleted: z.boolean(),
  label_name: z.string(),
  label_id: z.string(),
  messages_affected: z.number(),
  threads_affected: z.number(),
  message: z.string(),
});
export type DeleteLabelResult = z.infer<typeof DeleteLabelResultSchema>;

export const DeleteFilterResultSchema = z.object({
  deleted: z.boolean(),
  filter_id: z.string(),
  criteria_summary: z.string(),
  message: z.string(),
});
export type DeleteFilterResult = z.infer<typeof DeleteFilterResultSchema>;
```

### 4b. Update `src/composed/destructive.ts` — `deleteLabel`

```typescript
import type {
  ModifyResult,
  DeleteResult,
  SendResult,
  DeleteLabelResult,
  DeleteFilterResult,
} from '../types.js';

export async function deleteLabel(
  client: GmailClient,
  labelCache: LabelCache,
  nameOrId: string,
): Promise<DeleteLabelResult> {
  let id = nameOrId;
  const resolvedId = await labelCache.lookup(nameOrId);
  if (resolvedId) id = resolvedId;

  // Fetch label details BEFORE deleting so we can report what was affected
  let labelName = nameOrId;
  let messagesAffected = 0;
  let threadsAffected = 0;
  try {
    const detail = await client.labels.get(id);
    labelName = detail.name ?? nameOrId;
    messagesAffected = detail.messagesTotal ?? 0;
    threadsAffected = detail.threadsTotal ?? 0;
  } catch {
    // If we can't get details, still proceed with delete
  }

  try {
    await client.labels.delete(id);
    labelCache.invalidate();
    return {
      deleted: true,
      label_name: labelName,
      label_id: id,
      messages_affected: messagesAffected,
      threads_affected: threadsAffected,
      message:
        messagesAffected > 0
          ? `Deleted label "${labelName}". ${messagesAffected} messages (${threadsAffected} threads) are no longer labeled — the messages themselves were NOT deleted.`
          : `Deleted empty label "${labelName}".`,
    };
  } catch (err) {
    return {
      deleted: false,
      label_name: labelName,
      label_id: id,
      messages_affected: 0,
      threads_affected: 0,
      message: `Failed to delete label "${labelName}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

### 4c. Update `src/composed/destructive.ts` — `deleteFilter`

```typescript
export async function deleteFilter(
  client: GmailClient,
  filterId: string,
): Promise<DeleteFilterResult> {
  // Fetch filter details BEFORE deleting
  let criteriaSummary = 'unknown criteria';
  try {
    const filter = await client.filters.get(filterId);
    const parts: string[] = [];
    if (filter.criteria?.from) parts.push(`from:${filter.criteria.from}`);
    if (filter.criteria?.to) parts.push(`to:${filter.criteria.to}`);
    if (filter.criteria?.subject) parts.push(`subject:${filter.criteria.subject}`);
    if (filter.criteria?.query) parts.push(`query:${filter.criteria.query}`);
    if (filter.criteria?.hasAttachment) parts.push('has:attachment');
    criteriaSummary = parts.length > 0 ? parts.join(', ') : 'no specific criteria';
  } catch {
    // If we can't get details, still proceed with delete
  }

  try {
    await client.filters.delete(filterId);
    return {
      deleted: true,
      filter_id: filterId,
      criteria_summary: criteriaSummary,
      message: `Deleted filter (${criteriaSummary}). Future matching messages will no longer be auto-processed by this rule.`,
    };
  } catch (err) {
    return {
      deleted: false,
      filter_id: filterId,
      criteria_summary: criteriaSummary,
      message: `Failed to delete filter: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

### 4d. Update return types in `src/index.ts`

Import and use the new types:

```typescript
import type {
  // ... existing imports ...
  DeleteLabelResult,
  DeleteFilterResult,
} from './types.js';
```

Update method signatures:

```typescript
async deleteLabel(nameOrId: string): Promise<DeleteLabelResult> {
  return deleteLabel(this.client, this.labelCache, nameOrId);
}

async deleteFilter(filterId: string): Promise<DeleteFilterResult> {
  return deleteFilter(this.client, filterId);
}
```

### 4e. Update `deleteFilter` signature in `src/composed/destructive.ts`

Note that `deleteFilter` now needs `client: GmailClient` to call `client.filters.get()` — it already has this. Verify the `FiltersClient` has a `get(id)` method in `src/client/filters.ts`. If not, add one:

```typescript
async get(filterId: string) {
  const res = await this.execute(() =>
    this.gmail.users.settings.filters.get({
      userId: 'me',
      id: filterId,
    }),
  );
  return res.data;
}
```

---

## Task 5: Enrich ALL Write Operation Responses

**Goal:** Every POST/PUT operation should return a meaningful, human-readable `message` field explaining what happened.

### 5a. Update `ModifyResult` in `src/types.ts`

```typescript
export const ModifyResultSchema = z.object({
  modified: z.number(),
  failed: z.array(z.string()),
  message: z.string(),
});
```

### 5b. Update `src/composed/writers.ts`

Add `message` to both return values:

For `modifyMessages`:

```typescript
return {
  modified: messageIds.length - failed.length,
  failed,
  message:
    failed.length === 0
      ? `Successfully modified ${messageIds.length} message(s).${addLabels.length > 0 ? ` Added: ${addLabels.join(', ')}.` : ''}${removeLabels.length > 0 ? ` Removed: ${removeLabels.join(', ')}.` : ''}`
      : `Modified ${messageIds.length - failed.length} of ${messageIds.length} messages. ${failed.length} failed.`,
};
```

For `modifyThread`:

```typescript
// success case:
return {
  modified: 1,
  failed: [],
  message: `Modified thread.${addLabels.length > 0 ? ` Added: ${addLabels.join(', ')}.` : ''}${removeLabels.length > 0 ? ` Removed: ${removeLabels.join(', ')}.` : ''}`,
};
// failure case:
return {
  modified: 0,
  failed: [threadId],
  message: `Failed to modify thread ${threadId}.`,
};
```

### 5c. Update `src/composed/destructive.ts` — trash operations

For `trashMessages`:

```typescript
return {
  modified: messageIds.length - failed.length,
  failed,
  message:
    failed.length === 0
      ? `Moved ${messageIds.length} message(s) to Trash. Recoverable for 30 days.`
      : `Trashed ${messageIds.length - failed.length} of ${messageIds.length} messages. ${failed.length} failed.`,
};
```

For `trashThread`:

```typescript
// success:
return { modified: 1, failed: [], message: 'Thread moved to Trash. Recoverable for 30 days.' };
// failure:
return { modified: 0, failed: [threadId], message: `Failed to trash thread ${threadId}.` };
```

### 5d. Update `SendResult` in `src/types.ts`

```typescript
export const SendResultSchema = z.object({
  message_id: z.string(),
  thread_id: z.string().nullable(),
  message: z.string(),
});
```

### 5e. Update `src/composed/destructive.ts` — send operations

For `sendDraft`:

```typescript
export async function sendDraft(client: GmailClient, draftId: string): Promise<SendResult> {
  const result = await client.drafts.send(draftId);
  return {
    message_id: result.id ?? '',
    thread_id: result.threadId ?? null,
    message: `Draft sent successfully. Message ID: ${result.id ?? 'unknown'}.`,
  };
}
```

For `sendMessage`:

```typescript
const result = await client.messages.send(raw, options.threadId);
return {
  message_id: result.id ?? '',
  thread_id: result.threadId ?? null,
  message: `Email sent to ${options.to}. Subject: "${options.subject}".`,
};
```

### 5f. Update `DeleteResult` in `src/types.ts`

```typescript
export const DeleteResultSchema = z.object({
  deleted: z.boolean(),
  message: z.string(),
});
```

### 5g. Update remaining delete operations in `src/composed/destructive.ts`

For `deleteDraft`:

```typescript
export async function deleteDraft(client: GmailClient, draftId: string): Promise<DeleteResult> {
  try {
    await client.drafts.delete(draftId);
    return { deleted: true, message: `Draft ${draftId} permanently deleted.` };
  } catch (err) {
    return {
      deleted: false,
      message: `Failed to delete draft: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

### 5h. Update `createLabel` and `createFilter` in their respective files

For `createLabel` in `src/composed/labels.ts` — the return type is `LabelDetail` which is already rich. No changes needed.

For `createFilter` in `src/composed/filters.ts` — the return type is `FilterDetail` which is already rich. No changes needed.

For `createDraft` in `src/composed/drafts.ts` — the return type `DraftDetail` is already rich. No changes needed.

---

## Task 6: Add Gmail Web Citation URLs

**Goal:** Add a `web_url` field to every message so Claude can link users to specific emails.

### 6a. Add helper function

Create or add to `src/composed/helpers.ts`:

```typescript
/**
 * Construct a Gmail web UI URL for a given message.
 * Format: https://mail.google.com/mail/u/0/#inbox/{messageId}
 */
export function gmailWebUrl(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${messageId}`;
}
```

Using `#all/` instead of `#inbox/` ensures the link works regardless of which label the message is under.

### 6b. Add `web_url` to schemas in `src/types.ts`

Add to `MessageSummarySchema`:

```typescript
  web_url: z.string(),
```

Add to `FullMessageSchema`:

```typescript
  web_url: z.string(),
```

### 6c. Update `src/composed/search.ts`

Import `gmailWebUrl` and add to each message summary:

```typescript
import { parseContact, parseContactList, gmailWebUrl } from './helpers.js';

// In the message push:
messages.push({
  // ... existing fields ...
  web_url: gmailWebUrl(raw.id ?? ''),
});
```

### 6d. Update `src/composed/readers.ts`

Import `gmailWebUrl` and add to `transformMessage`:

```typescript
import { parseContact, parseContactList, deduplicateContacts, gmailWebUrl } from './helpers.js';

// In transformMessage return:
return {
  // ... existing fields ...
  web_url: gmailWebUrl(raw.id ?? ''),
};
```

---

## Task 7: Add `include_body` to `gmail_get_drafts`

**Goal:** Allow fetching draft bodies inline without separate read calls.

### 7a. Update `DraftDetailSchema` in `src/types.ts`

```typescript
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
  body_text: z.string().nullable().optional(), // <-- ADD THIS
});
```

### 7b. Update `src/composed/drafts.ts`

Add `includeBody` parameter:

```typescript
import { processMessagePayload } from './body-processing.js';

export async function getDrafts(
  client: GmailClient,
  labelCache: LabelCache,
  maxResults = 10,
  query?: string,
  includeBody = false, // <-- ADD THIS
): Promise<DraftSummary> {
  const listResult = await client.drafts.list({ maxResults, query });

  if (listResult.drafts.length === 0) {
    return { total: listResult.resultSizeEstimate, drafts: [] };
  }

  const ids = listResult.drafts.map((d) => d.id);
  const format = includeBody ? 'full' : 'metadata';
  const rawDrafts = await client.drafts.batchGet(ids, format);

  const drafts: DraftDetail[] = [];
  for (const raw of rawDrafts) {
    const msg = raw.message;
    const headers = new Map<string, string>();
    for (const h of msg?.payload?.headers ?? []) {
      if (h.name && h.value) headers.set(h.name, h.value);
    }

    let bodyText: string | null = null;
    if (includeBody && msg?.payload) {
      const { text } = await processMessagePayload(msg.payload, msg.payload.mimeType ?? undefined, {
        stripReplies: false,
        includeHtml: false,
      });
      bodyText = text;
    }

    drafts.push({
      draft_id: raw.id ?? '',
      message_id: msg?.id ?? '',
      thread_id: msg?.threadId ?? null,
      to: parseContactList(headers.get('To') ?? ''),
      cc: parseContactList(headers.get('Cc') ?? ''),
      subject: headers.get('Subject') ?? null,
      snippet: he.decode(msg?.snippet ?? ''),
      date: parseDate(headers.get('Date') ?? ''),
      size_bytes: msg?.sizeEstimate ?? 0,
      has_attachments: hasAttachments(msg?.payload),
      body_text: bodyText,
    });
  }

  return { total: listResult.resultSizeEstimate, drafts };
}
```

### 7c. Update MCP tool in `src/mcp-server.ts`

```typescript
if (isEnabled('gmail_get_drafts')) {
  server.tool(
    'gmail_get_drafts',
    toolRegistry.gmail_get_drafts.description,
    {
      max_results: z.number().optional().describe('Max drafts to return (default 10)'),
      query: z.string().optional().describe('Filter drafts by search query'),
      include_body: z
        .boolean()
        .optional()
        .describe('Include processed body text per draft (default false)'),
    },
    async ({ max_results, query, include_body }) => {
      const result = await getDrafts(client, labelCache, max_results, query, include_body);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
```

### 7d. Update library class in `src/index.ts`

```typescript
async getDrafts(maxResults?: number, query?: string, includeBody?: boolean): Promise<DraftSummary> {
  return getDrafts(this.client, this.labelCache, maxResults, query, includeBody);
}
```

---

## Task 8: Tune Tracking URL Shortener

**Problem:** The 100-char threshold doesn't trigger on real emails. Most tracking URLs are 70–100 chars.

### Update `src/composed/body-processing.ts`

In the `shortenTrackingUrls` function:

1. Lower the generic threshold from 100 to 80 characters
2. For known tracking domains, shorten regardless of length
3. Add more tracking domain patterns

```typescript
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
      } catch {
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
      } catch {
        return '[link]';
      }
    }

    return url;
  });
}
```

---

## Task 9: Move `gmail_delete_label` and `gmail_delete_filter` to Write Category

**Goal:** These are low-risk deletes. Move them from `destructive` (disabled) to `write` (enabled) tier in the tool registry.

### Update `src/config/tools.ts`

Move these two entries from the destructive section to the non-destructive write section:

```typescript
  // === Non-destructive writes (enabled by default) ===
  // ... existing tools ...

  gmail_delete_label: {
    enabled: true,
    category: 'write' as const,
    description: 'Delete a label (messages are NOT deleted, just un-labeled). Returns count of affected messages.',
  },
  gmail_delete_filter: {
    enabled: true,
    category: 'write' as const,
    description: 'Delete a filter rule (stops future auto-processing). Returns summary of deleted filter criteria.',
  },
```

Remove them from the destructive section.

---

## Task 10: Update Composed Index Exports

Ensure `src/composed/index.ts` exports all new/changed functions. The current exports should still work, but verify that new types are re-exported from `src/index.ts`:

In `src/index.ts`, add to the type imports:

```typescript
import type {
  // ... existing ...
  DeleteLabelResult,
  DeleteFilterResult,
  LabelContext,
} from './types.js';
```

---

## Task 11: Build and Test

After all changes:

```bash
npm run build
```

Fix any TypeScript compilation errors. Common issues to watch for:

1. **Missing `message` field** — if any code path returns a `ModifyResult`, `DeleteResult`, or `SendResult` without the new `message` field, TypeScript will catch it.
2. **`deleteLabel` / `deleteFilter` return type mismatch** — the MCP server currently types these as `DeleteResult`. Update the MCP tool handlers for these two tools to match the new `DeleteLabelResult` / `DeleteFilterResult` types.
3. **Import cycles** — `search.ts` now imports from `body-processing.ts`. This should be fine since there are no circular deps, but verify.

Once the build passes, run `npm run dev` and test the following via Claude Desktop:

- `gmail_search` with `include_body: true` — verify body text appears on each result
- `gmail_read_thread` — verify `label_context` appears with counts
- `gmail_delete_label` on a test label — verify rich response with affected message count
- `gmail_delete_filter` — verify rich response with criteria summary
- `gmail_modify_messages` — verify response includes human-readable `message`
- Verify `web_url` appears on search results and read messages

---

## Summary of All Changes

| File                              | Changes                                                                                                                                                                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                    | Add `body_text` to MessageSummary, `web_url` to MessageSummary + FullMessage, `LabelContextSchema`, `label_context` to FullThread, `DeleteLabelResult`, `DeleteFilterResult`, `message` field to ModifyResult/DeleteResult/SendResult, `thread_id` to SendResult, `body_text` to DraftDetail |
| `src/composed/search.ts`          | Add `includeBody` param, conditional full-format fetch + body processing, `web_url`, fix `hasAttachments`                                                                                                                                                                                    |
| `src/composed/readers.ts`         | Add `label_context` fetch to `readThread`, `web_url` to `transformMessage`, fix `extractAttachments`, add `isSystemLabel` helper                                                                                                                                                             |
| `src/composed/drafts.ts`          | Add `includeBody` param with body processing, fix `hasAttachments`                                                                                                                                                                                                                           |
| `src/composed/destructive.ts`     | Enrich `deleteLabel` (pre-fetch counts), enrich `deleteFilter` (pre-fetch criteria), add `message` to trash/send results                                                                                                                                                                     |
| `src/composed/writers.ts`         | Add `message` to `modifyMessages` and `modifyThread` results                                                                                                                                                                                                                                 |
| `src/composed/helpers.ts`         | Add `gmailWebUrl()` helper                                                                                                                                                                                                                                                                   |
| `src/composed/body-processing.ts` | Tune tracking URL shortener (lower threshold, more domains)                                                                                                                                                                                                                                  |
| `src/config/tools.ts`             | Move `delete_label`/`delete_filter` to write tier (enabled), update `gmail_search` description                                                                                                                                                                                               |
| `src/mcp-server.ts`               | Add `include_body` to search tool, add `include_body` to drafts tool                                                                                                                                                                                                                         |
| `src/index.ts`                    | Update method signatures, add new type exports                                                                                                                                                                                                                                               |
| `src/client/filters.ts`           | Add `get(filterId)` method if missing                                                                                                                                                                                                                                                        |

**Total: 12 files modified. No new files created.**
