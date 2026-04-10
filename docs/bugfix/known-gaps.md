# Known Gaps

This document tracks limitations, missing features, and planned improvements across the Gmail Toolkit. Each entry includes context about why the gap exists, what the current workaround is (if any), and what building it out would entail.

Last audited: 2026-04-09

---

## Layer 2 Coverage Gaps

The toolkit follows a three-layer architecture where Layer 1 (`src/client/`) wraps the raw Gmail API and Layer 2 (`src/composed/`) builds user-facing operations on top. Layer 2 currently covers 32 of 42 Layer 1 methods (76%). The remaining 10 methods are implemented at Layer 1 but have no composed operation exposing them.

### High Priority

#### Attachment Download

**Gap:** `MessagesClient.getAttachment(messageId, attachmentId)` exists in Layer 1 but is not exposed through Layer 2 or the `GmailToolkit` public API.

**Impact:** The toolkit can detect attachments (via `extractAttachments()` in `helpers.ts`) and returns metadata including attachment ID, filename, MIME type, and size — but there is no way to actually retrieve the attachment content. This is like a file browser that shows filenames but cannot open files.

**Current workaround:** None within the toolkit. A consumer would need to access the raw Gmail API client directly.

**What building it requires:**

- Add a `getAttachment(messageId: string, attachmentId: string)` function to `src/composed/messages.ts`
- Return the decoded binary content (Layer 1 returns base64url-encoded data)
- Consider returning a `Buffer` or streaming interface for large attachments
- Add a corresponding `gmail_get_attachment` MCP tool in `src/mcp-server/tools-messages.ts`
- Define an `AttachmentContent` response type in `src/types.ts`

#### Draft Editing

**Gap:** `DraftsClient.update(id, raw, threadId?)` exists in Layer 1 but is not exposed through Layer 2.

**Impact:** Drafts can be created (`createDraft`) and deleted (`deleteDraft`) but cannot be modified after creation. A workflow like "create a draft, review it, edit the subject, then send" requires deleting and recreating the draft.

**Current workaround:** Delete the existing draft and create a new one with the updated content. This loses the original draft ID, which may break references if other systems track draft IDs.

**What building it requires:**

- Add an `updateDraft(draftId: string, options: {...})` function to `src/composed/drafts.ts`
- Reuse the existing `buildRfc2822Message()` helper from `helpers.ts` to construct the updated message
- Add a corresponding `gmail_update_draft` MCP tool in `src/mcp-server/tools-drafts.ts`
- Add tool registry entry in `src/mcp-server/tool-registry.ts` (category: `write`)

---

### Medium Priority

#### Trash Recovery (Untrash)

**Gap:** `MessagesClient.untrash(id)` and `ThreadsClient.untrash(id)` exist in Layer 1 but have no Layer 2 counterparts.

**Impact:** The toolkit supports trashing messages and threads (`trashMessages`, `trashThread`) but cannot recover them. Trash operations are one-directional — recovery requires the Gmail web UI or direct API access.

**Context:** Gmail retains trashed items for 30 days before permanent deletion. During that window, `untrash` restores the item to its original location. This is the natural counterpart to the existing trash operations.

**What building it requires:**

- Add `untrashMessages(messageIds: string[])` to `src/composed/messages.ts` (following the `trashMessages` pattern with per-message error tracking)
- Add `untrashThread(threadId: string)` to `src/composed/threads.ts`
- Add corresponding MCP tools and registry entries (category: `write`)

#### Thread-Level Search

**Gap:** `ThreadsClient.list(options)` exists in Layer 1 but Layer 2 only exposes message-level search via `search()`.

**Impact:** The `search()` function returns individual messages. There is no way to search for threads as units — for example, "find all threads with more than 5 messages" or "find threads where the last reply was from me." Gmail's thread search groups messages by conversation, which is a different view than message search.

**Context:** The spec designates `search()` as the primary entry point (~80% of reads), and it operates at the message level intentionally. Thread search is a complementary view, not a replacement.

**What building it requires:**

- Add a `searchThreads(query, maxResults, pageToken)` function to `src/composed/threads.ts`
- Use `ThreadsClient.list()` + `ThreadsClient.get()` for metadata
- Define a `ThreadSummary` response type (thread ID, subject, participant count, message count, date range)
- Add a `gmail_search_threads` MCP tool

#### Single Draft Read

**Gap:** `DraftsClient.get(id, format?)` exists in Layer 1 but Layer 2 only provides `getDrafts()` which lists drafts in bulk.

**Impact:** To read a specific draft by ID, consumers must list all drafts and filter client-side, or use the raw client. This is inefficient when only one draft is needed (e.g., after creating a draft and wanting to confirm its content).

**What building it requires:**

- Add a `getDraft(draftId: string, includeBody?: boolean)` function to `src/composed/drafts.ts`
- Return the same `DraftDetail` type used by `getDrafts()`
- Add a `gmail_read_draft` MCP tool

#### Vacation Settings Write

**Gap:** `SettingsClient.updateVacation(settings)` exists in Layer 1 but Layer 2's `getAccount()` only reads vacation settings.

**Impact:** The toolkit can display whether vacation auto-reply is enabled and its subject/dates, but cannot enable, disable, or modify the vacation responder.

**What building it requires:**

- Add an `updateVacation(settings: {...})` function to `src/composed/account.ts`
- Accept structured input: enabled, subject, body, start/end dates, restrict-to-contacts flag
- Add a `gmail_update_vacation` MCP tool (category: `write`)

---

### Low Priority

#### Permanent Message/Thread Deletion

**Gap:** `MessagesClient.delete(id)` and `ThreadsClient.delete(id)` exist in Layer 1 but are intentionally not exposed.

**Context:** These methods permanently delete messages/threads, bypassing the 30-day trash recovery window. This is an irreversible, destructive operation that most users should never need. The existing `trashMessages`/`trashThread` operations are the safe alternative.

**Decision:** Intentionally omitted. If exposed in the future, these should be in the `destructive` tool category with a strong confirmation mechanism.

#### History Tracking

**Gap:** `HistoryClient.list(options)` exists in Layer 1 but has no Layer 2 counterpart.

**Context:** The History API tracks mailbox changes (messages added/deleted, labels changed) since a given history ID. It's designed for polling/sync workflows where an application needs to stay in sync with the mailbox without re-fetching everything. This is a specialized use case that most consumers don't need.

**What building it requires:**

- Add a `getHistory(startHistoryId, options?)` function to a new `src/composed/history.ts`
- Define `HistoryEvent` types for message additions, deletions, and label changes
- Consider whether this warrants an MCP tool (sync workflows are atypical for MCP use cases)

#### Raw MIME Processing

**Gap:** `processBody()` in `src/composed/body-processing.ts` is implemented and marked `@internal`. It processes raw RFC 2822 messages through the same 7-step text pipeline as `processMessagePayload()`, but accepts raw MIME input (base64url string or Buffer) instead of a Gmail API payload object.

**Context:** The toolkit always fetches messages in `FULL` format from the Gmail API, which returns a pre-parsed payload structure. `processMessagePayload()` operates on this structure directly. `processBody()` would be needed if the toolkit supported raw message import (e.g., `.eml` files) or `messages.get(format='RAW')`, neither of which exists today.

**Decision:** Code is preserved for future use. Will be wired up when a raw-fetch path is added to Layer 1.

#### Message Import

**Gap:** The Gmail API's `messages.import()` endpoint is not implemented in any layer.

**Context:** This endpoint imports a message into the mailbox from an external source (e.g., migration tools). It differs from `messages.send()` in that imported messages appear as received mail, not sent mail. Low priority — primarily useful for migration workflows.

---

## Infrastructure

### HTTP Batch Requests

**Gap:** The toolkit does not use Gmail's native multipart HTTP batch endpoint (`POST /batch/gmail/v1`). Instead, concurrent operations use `p-queue` with individual HTTP requests rate-limited to stay within Gmail's 250 quota units/second.

**Impact:** This works correctly and respects rate limits, but is less network-efficient than true batching for bulk operations. Each request in a "batch" is a separate HTTP round trip.

**Context:** Gmail's batch endpoint accepts up to 100 requests in a single multipart body, returning all responses in one HTTP response. Implementing this would reduce network overhead for operations like `batchGet` and `batchModify`, but the current approach is simpler and functionally equivalent.

### README.md

**Gap:** No README.md exists in the project root.

**Impact:** The project has no front-door documentation for developers discovering it on GitHub or npm. The architecture spec (`docs/Gmail_Toolkit_Project_Spec.md`) is comprehensive but targets contributors, not users.

**What it should include:**

- Project description and value proposition
- Installation instructions (`npm install gmail-toolkit`)
- Quick start code example (`GmailToolkit.create()` → `search()` → result)
- MCP server setup for Claude Desktop
- Authentication setup (credentials.json → OAuth flow)
- API reference summary with link to TypeDoc
- Architecture overview (for humans, not AI agents)
- Contributing guide
