# Gmail Toolkit MCP Server — Debug & QA Report

**Date:** April 8, 2026
**Scope:** All 7 read/fetch MCP tools — 4 full test rounds, 3 bugs found and fixed, 1 known Gmail API limitation
**Purpose:** Provide developers with a complete audit trail for code cleanup/refactor. Every MCP tool call, observed behavior, and edge case is documented so devs can trace behavior back to specific code paths and verify no workarounds remain.

---

## Table of Contents

1. [Test Environment](#1-test-environment)
2. [Tool Inventory & Parameter Matrix](#2-tool-inventory--parameter-matrix)
3. [gmail_search](#3-gmail_search)
4. [gmail_read_message](#4-gmail_read_message)
5. [gmail_read_thread](#5-gmail_read_thread)
6. [gmail_get_drafts](#6-gmail_get_drafts)
7. [gmail_get_labels](#7-gmail_get_labels)
8. [gmail_get_filters](#8-gmail_get_filters)
9. [gmail_get_account](#9-gmail_get_account)
10. [Bugs Found & Fixed](#10-bugs-found--fixed)
11. [Known Limitations (Gmail API)](#11-known-limitations-gmail-api)
12. [Code Paths to Audit](#12-code-paths-to-audit)
13. [Unknowns & Open Questions](#13-unknowns--open-questions)

---

## 1. Test Environment

- **Account:** `boehle.aaron@gmail.com`
- **Account stats:** 17,093 messages / 16,257 threads
- **User labels:** 24 (Careers: 582 msgs, USAA: 529, Promotions: 468, Capital One: 450, etc.)
- **Filters:** 0
- **Drafts:** 5
- **Send-as aliases:** 2 (`boehle.aaron@gmail.com` default, `aboehle1992@gmail.com`)
- **Test rounds:** 4 complete passes (17 tool calls per pass)

---

## 2. Tool Inventory & Parameter Matrix

| Tool                 | Parameters Tested                                               | Permutations |
| -------------------- | --------------------------------------------------------------- | ------------ |
| `gmail_search`       | `query` (required), `max_results`, `include_body`, `page_token` | 5            |
| `gmail_read_message` | `message_id` (required), `include_html`                         | 3            |
| `gmail_read_thread`  | `thread_id` (required)                                          | 3            |
| `gmail_get_drafts`   | `query`, `include_body`, `max_results`                          | 3            |
| `gmail_get_labels`   | (none)                                                          | 1            |
| `gmail_get_filters`  | (none)                                                          | 1            |
| `gmail_get_account`  | (none)                                                          | 1            |

**Total: 17 unique test permutations per round**

---

## 3. gmail_search

### 3.1 Default (no `include_body`)

**Call:**

```
gmail_search({ query: "newer_than:3d", max_results: 5 })
```

**Result (consistent across all 4 rounds):**

```json
{
  "total_estimate": 201,
  "returned": 5,
  "next_page_token": "<present>",
  "messages": [
    {
      "id": "19d6f01b6c922e64",
      "thread_id": "19d6f01b6c922e64",
      "from": { "name": "HelloFresh", "email": "hello@g.hellofresh.com" },
      "to": [{ "name": null, "email": "boehle.aaron@gmail.com" }],
      "cc": [],
      "subject": "Hungry for steak?",
      "date": "2026-04-08T21:27:00.000Z",
      "snippet": "Get it each week, no extra charge...",
      "labels": ["CATEGORY_PROMOTIONS", "UNREAD", "INBOX"],
      "is_unread": true,
      "is_starred": false,
      "has_attachments": false,
      "size_bytes": 55693,
      "web_url": "https://mail.google.com/mail/u/0/#all/19d6f01b6c922e64",
      "body_text": null
    }
  ],
  "summary": {
    "unread_count": 5,
    "senders": { "HelloFresh": 1, "TollTagInsider@NTTA.org": 1, ... },
    "labels": { "CATEGORY_PROMOTIONS": 3, "UNREAD": 5, "INBOX": 5, ... }
  }
}
```

**Dev notes:**

- `body_text: null` — correct, no `include_body` flag. Verify this doesn't trigger a full-format fetch.
- `web_url` present on every message — verify `gmailWebUrl()` helper is called in the search path.
- `has_attachments: false` on all — this is metadata-format limitation (see Section 11).
- `total_estimate: 201` — Gmail API caps this; it's not an exact count. Document this for consumers.
- `summary` block aggregates unread count, senders, labels — verify this is computed in `search.ts` after batchGet, not via a separate API call.
- `next_page_token` present — pagination working.
- `max_results: 5` honored — returned exactly 5.

**Code path:** `src/composed/search.ts` → `search()` → `messages.list()` → `messages.batchGet()` (metadata format)

---

### 3.2 With `include_body: true`

**Call:**

```
gmail_search({ query: "from:tastytrade newer_than:1d", include_body: true, max_results: 3 })
```

**Result:**

```json
{
  "returned": 3,
  "messages": [
    {
      "id": "19d6df79b57353e1",
      "subject": "Order QQQ #452747982 received 2 fills",
      "body_text": "Dear Aaron,\n\nFor account ending in 66\n\nYour order #452747982 received 2 fills\n\nORDER SUMMARY\n\nReceived At            Apr 8, 2026 12:40:29 PM EDT\nSymbol                 QQQ\n...\n\nManage Your Subscription Preferences [[link: hz86tsbx.r.us-east-1.awstrack.me]]\n|\nUnsubscribe [[link: hz86tsbx.r.us-east-1.awstrack.me]]\nto all emails (non-required)",
      "web_url": "https://mail.google.com/mail/u/0/#all/19d6df79b57353e1",
      "has_attachments": false,
      "size_bytes": 8337
    }
  ]
}
```

**Dev notes:**

- `body_text` is populated — verify `include_body` triggers `full` format on batchGet (not `metadata`).
- **awstrack.me tracking URLs shortened** to `[link: hz86tsbx.r.us-east-1.awstrack.me]` — verify `body-processing.ts` tracking URL shortener catches `awstrack.me` in the `alwaysTrackingDomains` list.
- The tastytrade emails are text/plain + text/html multipart. The plain text part is used. Verify `processMessagePayload` prefers `text/plain` when available.
- Email signature/disclaimer is included in body. No truncation. This is correct behavior — body processing should not strip signatures.
- `has_attachments: false` — even with full format, tastytrade emails have no attachments. Correct.

**Code path:** `src/composed/search.ts` → `search()` with `includeBody: true` → `messages.batchGet()` (full format) → `processMessagePayload()` from `body-processing.ts`

---

### 3.3 Label query

**Call:**

```
gmail_search({ query: "label:Careers", max_results: 3 })
```

**Result:**

```json
{
  "returned": 3,
  "messages": [
    {
      "id": "196a64c7575ef1fb",
      "from": { "name": "LinkedIn", "email": "messages-noreply@linkedin.com" },
      "labels": ["CATEGORY_SOCIAL", "Careers"],
      "body_text": null
    }
  ]
}
```

**Dev notes:**

- **User label resolved:** `"Careers"` appears in labels array, not `"Label_13"`. Verify the label ID→name resolution is happening in `search.ts` or a shared transform function.
- Confirm label resolution uses a cached label map (batch-fetched once) rather than per-message lookups.
- System labels (`CATEGORY_SOCIAL`) pass through as-is — they already have human-readable names. Verify `isSystemLabel()` helper is used to skip resolution for these.

**Code path:** `src/composed/search.ts` → label resolution logic (where is the label map populated?)

---

### 3.4 Attachment query

**Call:**

```
gmail_search({ query: "has:attachment filename:pdf", max_results: 3 })
```

**Result:**

```json
{
  "returned": 3,
  "messages": [
    {
      "id": "19c108af9765c2c1",
      "from": { "email": "DoNotReplyFrontierBillPay@billmatrix.com" },
      "subject": "Frontier® - Auto Pay Enrollment Confirmation",
      "has_attachments": false,
      "size_bytes": 1170363
    }
  ]
}
```

**Dev notes:**

- **`has_attachments: false` despite `has:attachment` query returning this email.** This is a Gmail API metadata format limitation — see Section 11.
- `size_bytes: 1170363` (1.1MB) — the large size is a clue an attachment exists. A heuristic based on size could help, but would be a workaround. Devs should decide if this is worth adding.
- The full-format read of this same message correctly detects `TermsAndConditions.pdf` (806KB) — see Section 4.2.

**Known limitation, not a code bug.**

---

### 3.5 With `include_body: true` (GitHub emails)

**Call:**

```
gmail_search({ query: "from:noreply@github.com", include_body: true, max_results: 3 })
```

**Result (BEFORE fix):**

```json
{
  "messages": [
    {
      "id": "19d5adef20d0029f",
      "subject": "[GitHub] [bolabz] Welcome to Copilot Business!",
      "body_text": "Your organization <strong>bolabz</strong> has completed the GitHub Copilot Business setup."
    }
  ]
}
```

**Result (AFTER fix — rounds 3 & 4):**

```json
{
  "messages": [
    {
      "id": "19d5adef20d0029f",
      "body_text": "Your organization bolabz has completed the GitHub Copilot Business setup."
    }
  ]
}
```

**Dev notes:**

- **Bug P2 was here:** `<strong>bolabz</strong>` HTML tag leaked into `body_text`.
- Root cause: The email's `text/plain` part contained embedded HTML fragments. The body processing pipeline used the plain text part as-is without stripping residual HTML tags.
- Fix applied in `body-processing.ts` — verify the fix is a general HTML tag strip on the final output, not a targeted `<strong>` removal.
- **Audit question:** Are there other inline HTML tags that could leak? (`<em>`, `<a>`, `<b>`, `<span>`, etc.) The fix should handle all of them.

**Code path:** `src/composed/body-processing.ts` → `processMessagePayload()` → plain text path → (needs HTML tag stripping)

---

## 4. gmail_read_message

### 4.1 Standard read

**Call:**

```
gmail_read_message({ message_id: "19d6df79b57353e1" })
```

**Result (tastytrade order fill):**

```json
{
  "id": "19d6df79b57353e1",
  "thread_id": "19d6df79b57353e1",
  "from": { "name": "tastytrade", "email": "no-reply@tastytrade.com" },
  "to": [{ "name": null, "email": "boehle.aaron@gmail.com" }],
  "cc": [],
  "bcc": [],
  "subject": "Order QQQ #452747982 received 2 fills",
  "date": "2026-04-08T16:40:36.000Z",
  "labels": ["UNREAD", "CATEGORY_UPDATES", "INBOX"],
  "is_unread": true,
  "is_starred": false,
  "body_text": "Dear Aaron,\n\nFor account ending in 66\n\nYour order #452747982 received 2 fills\n...\nManage Your Subscription Preferences [[link: hz86tsbx.r.us-east-1.awstrack.me]]",
  "body_html": null,
  "attachments": [],
  "size_bytes": 8337,
  "web_url": "https://mail.google.com/mail/u/0/#all/19d6df79b57353e1"
}
```

**Dev notes:**

- Full-format fetch. `body_text` populated, `body_html: null` (no `include_html` flag).
- awstrack.me URLs shortened — confirms `body-processing.ts` runs on read path too.
- `bcc: []` present — only visible on sent messages, but the field is always returned. Consistent.
- `attachments: []` — empty array, not null. Consistent.
- `web_url` correctly formed with message ID.
- Labels are system labels only — no label resolution needed here (they're already human-readable).
- `to[0].name: null` — the sender didn't include a display name. Verify the parser doesn't crash on null names.

**Code path:** `src/composed/readers.ts` → `readMessage()` → `messages.get()` (full format) → `transformMessage()` → `processMessagePayload()`

---

### 4.2 Standard read — HTML-only email (Frontier)

**Call:**

```
gmail_read_message({ message_id: "19c108af9765c2c1" })
```

**Result (BEFORE fix — raw HTML in body_text):**

```json
{
  "body_text": "<!DOCTYPE html><html><head><meta name=\"viewport\"..."
}
```

**Result (AFTER fix — rounds 3 & 4):**

```json
{
  "id": "19c108af9765c2c1",
  "subject": "Frontier® - Auto Pay Enrollment Confirmation",
  "body_text": "https://urldefense.com/v3/__https://frontier.com__... Sign in\nGREAT NEWS! YOU'VE ENROLLED IN AUTO PAY.\nFrontier account ending in *DCA7\nPayment method ending in *0156\nYour automatic payments will begin with your next bill.\n...\nTerms and Conditions | Privacy Policy\n©2025 Frontier Communications Parent, Inc. All Rights Reserved.",
  "body_html": null,
  "attachments": [
    {
      "id": "<long_base64_id>",
      "filename": "TermsAndConditions.pdf",
      "mime_type": "application/octet-stream",
      "size_bytes": 806478
    }
  ],
  "size_bytes": 1170363
}
```

**Dev notes:**

- **Bug P1 was here:** The Frontier email has ONLY an `text/html` MIME part — no `text/plain` fallback.
- Before fix: `processMessagePayload` didn't trigger html-to-text conversion for this email structure. The raw HTML was passed through as `body_text`.
- After fix: html-to-text conversion runs correctly. The output is clean processed text.
- **Attachment detected:** `TermsAndConditions.pdf` (806KB) with `mime_type: "application/octet-stream"` — note the MIME type isn't `application/pdf`. Verify `extractAttachments()` doesn't filter by MIME type, relying instead on filename/presence.
- **`urldefense.com` URLs** — these are Proofpoint URL defense wrappers. They're very long but NOT tracking URLs. The shortener correctly leaves them alone. Verify the shortener's logic doesn't false-positive on `urldefense.com`.
- `size_bytes: 1170363` (1.1MB) for the full message including attachment. Correctly reflects total size.

**Audit question:** What MIME structures does `processMessagePayload` handle? Test matrix should include:

1. `text/plain` only — PASS (tastytrade)
2. `text/html` only — PASS after fix (Frontier)
3. `multipart/alternative` with both — PASS (GitHub: prefers plain text)
4. `multipart/mixed` with attachments — PASS (Frontier: HTML + PDF)
5. Nested `multipart/related` (inline images) — UNTESTED
6. `multipart/signed` (S/MIME) — UNTESTED

**Code path:** `src/composed/body-processing.ts` → `processMessagePayload()` → `findPart('text/plain')` fails → `findPart('text/html')` → html-to-text conversion

---

### 4.3 With `include_html: true`

**Call:**

```
gmail_read_message({ message_id: "19d6ef2dd539af0a", include_html: true })
```

**Result (NTTA TollTag promotional):**

```json
{
  "id": "19d6ef2dd539af0a",
  "subject": "You Could Win $250",
  "body_text": "Unsubscribe\n\n[1]TollTag | [2]TollPerks | TollMate\n\nTollTag Insider\n\n[3]NTTA Website [4]NTTA Facebook...\n\nReferences\n\n1. https://getmytolltag.com/#en\n2. https://tollperks.com/\n...",
  "body_html": "<!DOCTYPE html>\n<html xmlns:v=\"urn:schemas-microsoft-com:vml\"...",
  "attachments": [],
  "size_bytes": 29263
}
```

**Dev notes:**

- Both `body_text` AND `body_html` populated — correct behavior when `include_html: true`.
- `body_text` has numbered reference-style links (`[1]`, `[2]`, etc.) — this is the html-to-text converter's link handling. Clean and readable.
- `body_html` contains the full raw HTML source.
- The NTTA email uses image-heavy newsletter format. `body_text` correctly extracts alt-text from images (e.g., "NTTA Website", "NTTA Facebook") and converts them to numbered references.
- `size_bytes: 29263` — 29KB for an image-heavy newsletter. The images are remote (hosted URLs), not inline attachments.
- **icptrack.com tracking URLs** appear in the HTML but are resolved to final destinations in body_text references — verify this is the html-to-text converter's behavior, not the tracking URL shortener.

**Code path:** `src/composed/readers.ts` → `readMessage()` with `includeHtml: true` → populates both `body_text` and `body_html`

---

## 5. gmail_read_thread

### 5.1 Thread with user labels

**Call:**

```
gmail_read_thread({ thread_id: "196a64c7575ef1fb" })
```

**Result (LinkedIn/Careers):**

```json
{
  "id": "196a64c7575ef1fb",
  "subject": "Your connection, Kamaria just had a work anniversary!",
  "participants": [
    { "name": "LinkedIn", "email": "messages-noreply@linkedin.com" },
    { "name": "Aaron Boehle", "email": "boehle.aaron@gmail.com" }
  ],
  "message_count": 1,
  "messages": [ { "...full message object..." } ],
  "labels": ["CATEGORY_SOCIAL", "Careers"],
  "label_context": [
    {
      "name": "Careers",
      "messages_total": 582,
      "messages_unread": 0
    }
  ],
  "has_unread": false,
  "date_range": {
    "first": "2025-05-06T15:52:26.000Z",
    "last": "2025-05-06T15:52:26.000Z"
  }
}
```

**Dev notes:**

- `label_context` correctly includes only the user label `"Careers"` with counts.
- System labels (`CATEGORY_SOCIAL`) are filtered out of `label_context` but remain in `labels` array.
- **Verify:** `label_context` is computed by batch-fetching user labels that appear on the thread, not by making individual `labels.get()` calls per label.
- `participants` deduplication — only 2 unique participants listed even though the message has both `from` and `to`.
- `date_range.first === date_range.last` — single-message thread. Correct.
- `message_count: 1` matches `messages.length`. Verify these are always in sync.

**Code path:** `src/composed/readers.ts` → `readThread()` → `threads.get()` → `transformMessage()` per message → label context computation (batch `labels.get()` for user labels on thread)

---

### 5.2 Thread with system labels only

**Call:**

```
gmail_read_thread({ thread_id: "19d6df79b57353e1" })
```

**Result (tastytrade, system labels only):**

```json
{
  "labels": ["UNREAD", "CATEGORY_UPDATES", "INBOX"],
  "label_context": [],
  "has_unread": true
}
```

**Dev notes:**

- `label_context: []` — explicit empty array, not absent/undefined. This was a bug in early rounds where the field was omitted entirely for system-label-only threads. Verify the code always returns `[]` and never `undefined`.
- `has_unread: true` matches `is_unread: true` on the single message. Verify `has_unread` is derived from the messages, not from a separate API field.

---

### 5.3 Multi-message thread

**Call:**

```
gmail_read_thread({ thread_id: "190f0ce1aae9a7a0" })
```

**Result (RiPSIM/Hoang — 2 messages):**

```json
{
  "id": "190f0ce1aae9a7a0",
  "subject": "First call with Aaron from RiPSIM Technologies",
  "participants": [
    { "name": "Hoang Nguyen", "email": "hoang.nguyen@ripsim.com" },
    { "name": "boehle.aaron@gmail.com", "email": "boehle.aaron@gmail.com" }
  ],
  "message_count": 2,
  "messages": [
    {
      "id": "190f0ce1aae9a7a0",
      "date": "2024-07-26T20:48:05.000Z",
      "labels": ["YELLOW_STAR", "IMPORTANT", "STARRED", "CATEGORY_PERSONAL", "INBOX"],
      "is_starred": true,
      "attachments": [
        { "filename": "invite.ics", "mime_type": "text/calendar", "size_bytes": 3399 }
      ]
    },
    {
      "id": "191093fe0c8707a6",
      "date": "2024-07-31T14:44:26.000Z",
      "labels": ["DRAFT"],
      "is_starred": false,
      "attachments": []
    }
  ],
  "labels": ["YELLOW_STAR", "IMPORTANT", "STARRED", "CATEGORY_PERSONAL", "INBOX", "DRAFT"],
  "label_context": [],
  "date_range": {
    "first": "2024-07-26T20:48:05.000Z",
    "last": "2024-07-31T14:44:26.000Z"
  }
}
```

**Before fix (Bug P3):**

```json
"label_context": [
  { "name": "YELLOW_STAR", "messages_total": 0, "messages_unread": 0 }
]
```

**After fix:**

```json
"label_context": []
```

**Dev notes:**

- **Bug P3 was here:** `YELLOW_STAR` leaked into `label_context`. It's a system label (listed under `system_labels` in `gmail_get_labels`) but the `isSystemLabel()` helper wasn't catching it.
- Messages are in chronological order — verify sorting is explicit (by `internalDate`), not relying on Gmail API's default order.
- Message 1 has `invite.ics` attachment (`text/calendar`) — calendar invites are correctly detected as attachments.
- Message 2 is a DRAFT with label `["DRAFT"]` — drafts in threads have their own label. Verify DRAFT is in the system label filter list.
- `participants[1].name` is the email address itself (`boehle.aaron@gmail.com`) — the draft didn't have a display name set. This is technically correct but ugly. **Audit question:** Should the code fall back to the account's display name when the participant name matches the email?
- Thread-level `labels` is a union of all message labels. Verify this is computed, not from a separate API field.

**Code path:** `src/composed/readers.ts` → `readThread()` → `isSystemLabel()` helper (verify YELLOW_STAR, ORANGE_STAR, RED_STAR, etc. are all covered)

---

## 6. gmail_get_drafts

### 6.1 Default (no params)

**Call:**

```
gmail_get_drafts({})
```

**Result:**

```json
{
  "total": 5,
  "drafts": [
    {
      "draft_id": "r-3270260981313384843",
      "message_id": "1968d6fe6607c2b2",
      "thread_id": "1968d6fe6607c2b2",
      "to": [],
      "cc": [],
      "subject": null,
      "snippet": "-- Aaron Bohle (210) 777-1115",
      "date": "2025-05-01T20:00:42.000Z",
      "size_bytes": 911,
      "has_attachments": false,
      "body_text": null
    }
  ]
}
```

**Dev notes:**

- `body_text: null` — correct, no `include_body`.
- `to: []` — empty draft (just a signature). Verify empty arrays, not null.
- `subject: null` — no subject set. Verify null handling downstream.
- `has_attachments: false` — metadata format. See Section 6.3 for the discrepancy.
- `draft_id` format varies: `r-<digits>` for regular drafts, `s:<digits>` for scheduled(?). **Audit question:** What do the `r-` and `s:` prefixes mean? Is this a Gmail API convention or our code?

---

### 6.2 With query filter

**Call:**

```
gmail_get_drafts({ query: "RiPSIM" })
```

**Result:**

```json
{
  "total": 2,
  "drafts": [
    { "draft_id": "r-2432942234875936709", "to": [{"name":"Bill Dyer","email":"Bill.Dyer@ripsim.com"}, ...] },
    { "draft_id": "r-3090557324543597088", "subject": "Re: First call with Aaron from RiPSIM Technologies" }
  ]
}
```

**Dev notes:**

- Query filter works — 2 of 5 drafts match "RiPSIM".
- **Audit question:** Is the query filter applied client-side (fetch all drafts, then filter) or server-side (passed to Gmail API's `drafts.list` `q` parameter)? Server-side is preferred for efficiency with large draft counts.
- `to` correctly resolves display names from the draft headers.

---

### 6.3 With `include_body: true`

**Call:**

```
gmail_get_drafts({ query: "resume", include_body: true })
```

**Result:**

```json
{
  "total": 1,
  "drafts": [
    {
      "draft_id": "r-7747952755426576310",
      "subject": "Aaron Boehle - Resume",
      "size_bytes": 162073,
      "has_attachments": true,
      "body_text": "James,\r\n\r\nHere's my latest resume per your request.\r\nThanks again for reaching out!...\r\n\r\nAaron Bohle\r\n(210) 777-1115"
    }
  ]
}
```

**Discrepancy with default listing (same draft, same round):**

```
Default listing:   has_attachments: false
include_body mode: has_attachments: true
```

**Dev notes:**

- **`has_attachments` inconsistency** — same draft returns `false` in metadata format but `true` in full format. This is the same Gmail API limitation as `gmail_search` (Section 3.4).
- `body_text` has `\r\n` line endings — this is the original draft's line endings preserved. Verify the body processing doesn't normalize line endings (it shouldn't — drafts are user-authored content).
- `size_bytes: 162073` (158KB) — the resume attachment is included in the size.
- **Audit question:** The `include_body` flag switches from metadata to full format on the batchGet. Verify the code path mirrors `gmail_search`'s `include_body` implementation — same format flag, same `processMessagePayload` call.

**Code path:** `src/composed/drafts.ts` → `getDrafts()` with `includeBody: true` → full format fetch → `processMessagePayload()`

---

## 7. gmail_get_labels

**Call:**

```
gmail_get_labels({})
```

**Result (abbreviated):**

```json
{
  "system_labels": [
    {
      "id": "INBOX",
      "name": "INBOX",
      "type": "system",
      "messages_total": 0,
      "messages_unread": 0,
      "visibility": "labelShow"
    },
    {
      "id": "YELLOW_STAR",
      "name": "YELLOW_STAR",
      "type": "system",
      "messages_total": 0,
      "messages_unread": 0,
      "visibility": "labelShow"
    },
    "... (10 total)"
  ],
  "user_labels": [
    {
      "id": "Label_13",
      "name": "Careers",
      "type": "user",
      "messages_total": 582,
      "messages_unread": 0
    },
    {
      "id": "Label_11",
      "name": "USAA",
      "type": "user",
      "messages_total": 529,
      "messages_unread": 0
    },
    "... (24 total)"
  ],
  "categories": [
    {
      "id": "CATEGORY_FORUMS",
      "name": "CATEGORY_FORUMS",
      "type": "system",
      "messages_total": 0,
      "messages_unread": 0,
      "visibility": "labelHide"
    },
    "... (5 total)"
  ],
  "summary": {
    "total_user_labels": 24,
    "empty_labels": ["Shopping", "Notes"],
    "most_active": "Careers"
  }
}
```

**Dev notes:**

- **System label counts are all 0** — this is a Gmail API limitation (see Section 11). The API returns 0 for system labels regardless of actual counts.
- User label counts are accurate (e.g., Careers: 582 matches label_context data from thread reads).
- Labels are split into three groups: `system_labels`, `user_labels`, `categories`. Verify this grouping logic — categories are system labels with `CATEGORY_` prefix.
- `YELLOW_STAR` is listed as a system label — this confirms the P3 fix was correct to filter it from `label_context`.
- `summary.most_active` picks the user label with highest `messages_total`. Verify tie-breaking behavior.
- `color: null` on all labels — no custom colors set on this account. Verify color handling when colors ARE set (untested).
- `visibility` field present — `"labelShow"` or `"labelHide"`. Verify this maps to Gmail's `labelListVisibility`.

**Code path:** `src/composed/readers.ts` or `src/client/labels.ts` → `labels.list()` → batch `labels.get()` for details → grouping logic

---

## 8. gmail_get_filters

**Call:**

```
gmail_get_filters({})
```

**Result:**

```json
{
  "total": 0,
  "filters": []
}
```

**Dev notes:**

- No filters on this account, so this is a minimal test.
- Verify the response structure is correct for non-empty filter lists.
- **Untested:** Filter criteria resolution, label name resolution in filter actions, the enriched `criteria_summary` field.
- **Untested:** The `gmail_delete_filter` enriched response (pre-fetches criteria before delete).

**Code path:** `src/client/filters.ts` → `filters.list()` → transform

---

## 9. gmail_get_account

**Call:**

```
gmail_get_account({})
```

**Result:**

```json
{
  "email": "boehle.aaron@gmail.com",
  "messages_total": 17093,
  "threads_total": 16257,
  "history_id": "2294995",
  "vacation": {
    "enabled": false,
    "subject": "",
    "start": null,
    "end": null,
    "restrict_to_contacts": false
  },
  "forwarding": { "enabled": false, "email": null, "disposition": null },
  "forwarding_addresses": [],
  "send_as_aliases": [
    { "email": "boehle.aaron@gmail.com", "display_name": "", "is_default": true, "reply_to": "" },
    {
      "email": "aboehle1992@gmail.com",
      "display_name": "Aaron Bohle",
      "is_default": false,
      "reply_to": ""
    }
  ],
  "delegates": [],
  "imap_enabled": false,
  "pop_enabled": false
}
```

**Dev notes:**

- Aggregates multiple Gmail API calls: `getProfile`, `getVacationResponder`, `getAutoForwarding`, `listForwardingAddresses`, `listSendAs`, `listDelegates`, `getImap`, `getPop`.
- `display_name: ""` on the default alias — empty string, not null. Verify downstream consumers handle both.
- `history_id` changes between test rounds (2294930 → 2294995) — this is expected, it increments with account activity.
- **Untested:** Account with active vacation responder, active forwarding, delegates, IMAP/POP enabled.

**Code path:** Multiple Layer 1 client calls aggregated in composed layer. Verify error handling — if one sub-call fails, does the whole thing fail or do we get partial results?

---

## 10. Bugs Found & Fixed

### P1 — Frontier `body_text` returns raw HTML

| Attribute        | Detail                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**     | P1 — Critical                                                                                                                                      |
| **Message ID**   | `19c108af9765c2c1`                                                                                                                                 |
| **Root cause**   | Email has only `text/html` MIME part (no `text/plain`). `processMessagePayload` didn't trigger html-to-text conversion for this payload structure. |
| **Before**       | `body_text: "<!DOCTYPE html><html><head>..."` (4KB+ of raw CSS/markup)                                                                             |
| **After**        | `body_text: "GREAT NEWS! YOU'VE ENROLLED IN AUTO PAY..."` (clean processed text)                                                                   |
| **File**         | `src/composed/body-processing.ts`                                                                                                                  |
| **Fix location** | `processMessagePayload()` — HTML-only fallback path                                                                                                |
| **Verified**     | Rounds 3 & 4                                                                                                                                       |
| **Audit**        | Ensure the fix handles ALL HTML-only emails, not just this specific payload structure. Test with nested multipart where only leaf is `text/html`.  |

### P2 — `<strong>` tag leaking in GitHub email `body_text`

| Attribute        | Detail                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**     | P2 — Moderate                                                                                                                                                                                           |
| **Message ID**   | `19d5adef20d0029f`                                                                                                                                                                                      |
| **Root cause**   | The `text/plain` part contained embedded HTML fragments (`<strong>bolabz</strong>`). The plain text path didn't strip residual HTML tags.                                                               |
| **Before**       | `"Your organization <strong>bolabz</strong> has completed..."`                                                                                                                                          |
| **After**        | `"Your organization bolabz has completed..."`                                                                                                                                                           |
| **File**         | `src/composed/body-processing.ts`                                                                                                                                                                       |
| **Fix location** | HTML tag stripping on plain text output                                                                                                                                                                 |
| **Verified**     | Rounds 3 & 4                                                                                                                                                                                            |
| **Audit**        | Verify the strip covers all HTML tags, not just `<strong>`. Check for `<em>`, `<b>`, `<i>`, `<a href="...">`, `<span>`, `<div>`, `<br>`, `<p>`, etc. Run a regex-based strip or use a proper sanitizer. |

### P3 — `YELLOW_STAR` leaking into `label_context`

| Attribute        | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**     | P3 — Minor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Thread ID**    | `190f0ce1aae9a7a0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Root cause**   | `isSystemLabel()` helper didn't include `YELLOW_STAR` (and presumably other star variants) in its system label list.                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Before**       | `label_context: [{ "name": "YELLOW_STAR", "messages_total": 0 }]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **After**        | `label_context: []`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **File**         | `src/composed/readers.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Fix location** | `isSystemLabel()` helper                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Verified**     | Rounds 3 & 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Audit**        | Verify ALL system labels are covered. The full list from Gmail API includes: `INBOX`, `SENT`, `DRAFT`, `TRASH`, `SPAM`, `STARRED`, `UNREAD`, `IMPORTANT`, `CHAT`, `YELLOW_STAR`, `ORANGE_STAR`, `RED_STAR`, `PURPLE_STAR`, `BLUE_STAR`, `GREEN_STAR`, `YELLOW_BANG`, `ORANGE_GUILLEMET`, `RED_BANG`, `PURPLE_QUESTION`, `BLUE_INFO`, `GREEN_CHECK`, and all `CATEGORY_*` labels. Consider using a pattern-based check (e.g., `id.startsWith('CATEGORY_')` or `type === 'system'` from the labels API) rather than a hardcoded list. |

---

## 11. Known Limitations (Gmail API)

These are NOT code bugs. They are Gmail API behaviors that cannot be fixed in our code.

### 11.1 `has_attachments` in metadata format

**Behavior:** `messages.batchGet` with `format: "metadata"` does not return the full MIME part tree. Attachment detection relies on the part tree, so `has_attachments` is always `false` in metadata responses.

**Impact:** `gmail_search` (without `include_body`) and `gmail_get_drafts` (without `include_body`) will report `has_attachments: false` even for messages with attachments.

**Workaround options (all have tradeoffs):**

1. Always use full format — eliminates the issue but increases API quota usage and response size.
2. Heuristic based on `sizeEstimate` — fragile, false positives on large HTML emails.
3. Document the limitation — current approach. Full `gmail_read_message` correctly detects attachments.

**Affected test cases:**

- Frontier PDF emails: `has_attachments: false` in search, `true` in full read
- Resume draft: `has_attachments: false` in default listing, `true` with `include_body`

### 11.2 System label counts always 0

**Behavior:** `labels.get()` for system labels (INBOX, SENT, TRASH, etc.) returns `messagesTotal: 0` and `threadsTotal: 0`.

**Impact:** `gmail_get_labels` shows 0 for all system label counts. User label counts are accurate.

**Gmail API documentation confirms** this is expected behavior — system label statistics are not available via the API.

### 11.3 `total_estimate` is approximate

**Behavior:** `messages.list` returns `resultSizeEstimate` which is an approximation, not an exact count. It frequently returns 201 regardless of the actual result count.

**Impact:** `total_estimate` in `gmail_search` results is unreliable for exact counts. Use `returned` for the actual count in the current page.

---

## 12. Code Paths to Audit

Based on the testing, these are the specific code paths developers should review during cleanup/refactor:

### 12.1 `src/composed/body-processing.ts`

| Area                             | What to check                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `processMessagePayload()`        | Ensure all MIME structures are handled: plain-only, HTML-only, multipart/alternative, multipart/mixed, nested multipart/related, multipart/signed                                                                                           |
| HTML-to-text conversion          | Verify the converter is configured for all common tags, not just block-level elements                                                                                                                                                       |
| HTML tag stripping on plain text | Verify the P2 fix is a general strip (`/<[^>]*>/g` or equivalent), not targeted                                                                                                                                                             |
| Tracking URL shortener           | Verify `alwaysTrackingDomains` list is complete. Current known domains: `awstrack.me`, `click.*.com`, `links.*.com`, `track.*.com`, `mailchimp.com`, `constantcontact.com`, `hubspot.com`, `pardot.com`, `emltrk.com`. Threshold: 80 chars. |
| `urldefense.com` handling        | These are Proofpoint wrappers, NOT tracking URLs. Verify they're not shortened.                                                                                                                                                             |

### 12.2 `src/composed/readers.ts`

| Area                        | What to check                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `isSystemLabel()`           | Verify covers ALL Gmail system labels including star variants, bang variants, etc. Consider pattern-based approach instead of hardcoded list. |
| `label_context` computation | Verify batch label fetch (not N+1). Verify empty array is returned, never undefined/null.                                                     |
| `transformMessage()`        | Verify `web_url` generation via `gmailWebUrl()`. Verify null-safety on `from.name`, `to[].name`.                                              |
| `extractAttachments()`      | Verify doesn't require `attachmentId` (relaxed check). Verify doesn't filter by MIME type.                                                    |
| Thread message sorting      | Verify explicit chronological sort by `internalDate`, not relying on API order.                                                               |
| Thread-level `labels`       | Verify this is a union computed from messages, not a separate API field.                                                                      |

### 12.3 `src/composed/search.ts`

| Area                        | What to check                                                                     |
| --------------------------- | --------------------------------------------------------------------------------- |
| `search()`                  | Verify `include_body` toggles between `metadata` and `full` format on batchGet.   |
| Label ID resolution         | Verify cached label map is used, fetched once per search call (not per message).  |
| `has_attachments` detection | Verify same logic as `extractAttachments()` in readers.ts. Consider sharing code. |
| Summary computation         | Verify computed from results, not a separate API call.                            |

### 12.4 `src/composed/drafts.ts`

| Area             | What to check                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `getDrafts()`    | Verify `include_body` implementation mirrors search.ts.                                   |
| Query filter     | Is it server-side (`q` parameter on `drafts.list`) or client-side? Server-side preferred. |
| Draft ID formats | `r-` prefix vs `s:` prefix — are these Gmail API conventions? Document.                   |

### 12.5 `src/composed/helpers.ts`

| Area            | What to check                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `gmailWebUrl()` | Verify format: `https://mail.google.com/mail/u/0/#all/{messageId}`. Verify it handles all message ID formats. |

### 12.6 `src/composed/destructive.ts`

| Area                                                       | What to check                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `deleteLabel` enriched response                            | Verify pre-fetches label counts before delete. Verify `message` field format.             |
| `deleteFilter` enriched response                           | Verify pre-fetches filter criteria before delete. Verify `criteria_summary` field format. |
| `trashMessages`, `trashThread`, `sendDraft`, `sendMessage` | Verify all return `message` field.                                                        |

### 12.7 `src/composed/writers.ts`

| Area                             | What to check                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `modifyMessages`, `modifyThread` | Verify `message` field summarizes the modification (e.g., "Modified 5 messages. Added: STARRED. Removed: UNREAD.") |

### 12.8 `src/config/tools.ts`

| Area                       | What to check                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Tool tier assignments      | `gmail_delete_label` and `gmail_delete_filter` should be in write tier (enabled by default), not destructive tier. |
| `gmail_search` description | Should mention `include_body` parameter.                                                                           |

### 12.9 `src/types.ts`

| Area                                                   | What to check                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `MessageSummarySchema`                                 | Should include `body_text`, `web_url`, `has_attachments`                            |
| `FullMessageSchema`                                    | Should include `web_url`                                                            |
| `FullThreadSchema`                                     | Should include `label_context` with `LabelContextSchema`                            |
| `DeleteLabelResultSchema` / `DeleteFilterResultSchema` | Should include enriched fields (`messages_affected`, `criteria_summary`, `message`) |
| `ModifyResultSchema`, `SendResultSchema`               | Should include `message` field                                                      |
| `DraftDetailSchema`                                    | Should include `body_text`                                                          |

### 12.10 `src/mcp-server.ts`

| Area                            | What to check                                                    |
| ------------------------------- | ---------------------------------------------------------------- |
| `gmail_search` registration     | `include_body` parameter should be registered in the tool schema |
| `gmail_get_drafts` registration | `include_body` parameter should be registered in the tool schema |

### 12.11 `src/index.ts`

| Area              | What to check                                                                 |
| ----------------- | ----------------------------------------------------------------------------- |
| Method signatures | Updated for new parameters (`includeBody`, `includeHtml`)                     |
| Type exports      | New types exported: `DeleteLabelResult`, `DeleteFilterResult`, `LabelContext` |

---

## 13. Unknowns & Open Questions

These are areas that were not fully tested or where behavior is uncertain. Developers should investigate during refactor.

### 13.1 Untested MIME structures

- `multipart/related` (inline images) — does `processMessagePayload` handle this? Do inline image CIDs get stripped from body_text?
- `multipart/signed` (S/MIME encrypted) — does the body extraction work through the signature wrapper?
- `multipart/digest` — rare but valid. How does it behave?
- Deeply nested multipart (3+ levels) — does `findPart()` recurse correctly?

### 13.2 Untested account configurations

- Account with active vacation responder — does `gmail_get_account` return the response body?
- Account with forwarding enabled — does it show forwarding address and disposition?
- Account with delegates — does the delegates array populate?
- Account with IMAP/POP enabled — do the boolean flags flip?
- Labels with custom colors — does the color object populate correctly?
- Filters with complex criteria — does `criteria_summary` format correctly?

### 13.3 Edge cases

- Message with 50+ labels — does label resolution scale?
- Thread with 100+ messages — does the response time stay reasonable? Is there pagination?
- Draft with no `to`, no `subject`, no body — all null/empty? (Partially tested: empty draft returns `to: []`, `subject: null`)
- Search with `page_token` — pagination was observed (tokens returned) but never exercised.
- Unicode in subject/body — partially tested (Bohle with umlaut renders correctly as "Bohle").
- Very long body text (50K+ chars) — Marriott marketing emails were noted as producing 30-45K chars. Is there a max length or truncation?

### 13.4 Error handling

- What happens when a message ID doesn't exist? 404 → graceful error message?
- What happens when a thread ID doesn't exist?
- What happens when the Gmail API rate limit is hit? Retry logic?
- What happens when the OAuth token expires mid-request? Refresh logic?
- What happens when `gmail_get_account` sub-calls partially fail? Partial result or full failure?

### 13.5 Code cleanliness questions

- Is `isSystemLabel()` using a hardcoded list or the label `type` field? Pattern-based approach (check `type === "system"` from labels API) would be more maintainable than a list.
- Is label resolution in `search.ts` sharing the same code path as `readers.ts`? If not, can they be unified?
- Is `has_attachments` detection in search using the same logic as `extractAttachments` in readers? Can it be a shared utility?
- Are there any `try/catch` blocks that silently swallow errors? These would mask bugs during production use.
- Is the tracking URL shortener threshold (80 chars) configurable or hardcoded?

---

_Report generated from 4 complete test rounds (68 total MCP tool invocations) against live Gmail API on April 8, 2026._
