# Gmail Toolkit MCP — Feedback Summary & Implementation Recommendations

**Date:** April 13, 2026
**Source:** End-to-end testing across 5 regression rounds + real-world email management workflows
**Audience:** Dev team

---

## 1. Error Handling — Make Errors Actionable

### Problem

Error messages currently report *what failed* but not *what to do next*. Two specific cases surfaced during testing:

**Batch size limit exceeded:** When a query like `label:Promotions` matches 1,000+ messages, the response returns a raw dump of failed message IDs. The caller has no way to recover without guessing at a strategy.

**Quota exceeded (Gmail API 403):** The error says `"Quota exceeded for quota metric 'Queries' and limit 'Queries per minute per user'"` with `"retryable": false`. This tells the caller nothing about when to retry, what the actual limit is, or how to restructure the query to avoid the issue.

### Recommendation

Every error response should include three fields:

```json
{
  "error": "batch_size_exceeded",
  "message": "Query matched 1,247 messages, exceeding the 1,000-message batch limit.",
  "recovery": {
    "strategy": "split_by_date",
    "suggestion": "Split into two queries: before:2026-01-01 and after:2026-01-01",
    "estimated_splits": 2
  }
}
```

```json
{
  "error": "quota_exceeded",
  "message": "Gmail API per-user per-minute quota exceeded during messages.listAll.",
  "recovery": {
    "strategy": "wait_and_narrow",
    "retry_after_seconds": 60,
    "suggestion": "Add a date range (e.g., after:2026-01-01) to reduce result set size, then retry after 60 seconds.",
    "estimated_result_count": 592
  }
}
```

The pattern is: **what happened** + **why** + **what to do next** (with concrete values, not generic advice).

---

## 2. Rate Limit Resolution — Performance Over Restriction

### Problem

Auto-pagination with `messages.listAll` eagerly fetches every matching message ID across all pages before starting `threads.batchGet`. For large result sets (500+ messages), this burns through Gmail's per-user per-minute quota before any results are returned.

Observed during testing:

| Query | Estimated Results | Outcome |
|---|---|---|
| `label:Fitness after:2026-04-10` | 2 | Instant success |
| `label:Finance/USAA after:2026-01-01` | 31 | Success (auto-paginated) |
| `label:Finance/USAA` (all time) | 592 | **Quota exceeded** |
| `label:INBOX is:unread` | ~4,700 | **Quota exceeded** |

### Root Cause

The pipeline is sequential: **list ALL IDs** → **then batch-fetch thread metadata**. This means a 592-message label requires ~12 list pages (at 50/page) to complete before any thread data is requested. Each page consumes quota, and the batchGet calls that follow consume more.

### Recommended Fix: Pipelined Fetch with Concurrency Control

Rather than limiting results, restructure the fetch pipeline:

**Phase 1 — Stream IDs into batches:** As each page of message IDs returns from `messages.list`, immediately queue a `threads.batchGet` for those IDs. Don't wait for all pages to complete.

**Phase 2 — Concurrency limiter:** Cap concurrent API calls at a safe level. Gmail's per-user quota is 250 quota units/second. Key costs:

| Operation | Quota Units |
|---|---|
| `messages.list` | 5 per call |
| `messages.get` | 5 per call |
| `threads.list` | 10 per call |
| `threads.get` | 10 per call |
| `messages.batchGet` (100 msgs) | 50 per call |

**Recommended defaults:**

| Setting | Value | Rationale |
|---|---|---|
| Max concurrent API calls | 5 | Keeps burst under 50 units/sec, well within 250 limit |
| Auto-pagination page size | 50 | Gmail default, good balance |
| Max pages before safety cap | 20 (1,000 messages) | Prevents runaway pagination on unbounded queries |
| Backoff on 429/403 | Exponential, starting at 2 seconds | Gmail rate limits reset per-minute |

**Phase 3 — Field filtering:** Use Gmail API's `fields` parameter on `messages.get` and `threads.get` to request only the metadata fields that search results actually use. Full message payloads are wasteful when search only needs `id`, `threadId`, `labelIds`, `snippet`, `internalDate`, `from`, `to`, `subject`, `sizeEstimate`.

```
fields=messages(id,threadId,labelIds,snippet,payload/headers,internalDate,sizeEstimate)
```

This alone can cut response payload (and processing time) by 60-80% for HTML-heavy emails.

**Phase 4 — Graceful degradation:** If pagination hits the safety cap (1,000 messages), return the results collected so far with a clear signal:

```json
{
  "total_messages": 1000,
  "truncated": true,
  "truncation_reason": "safety_cap",
  "suggestion": "Add date range or label filters to narrow results. Oldest message returned: 2026-01-15.",
  "threads": [...]
}
```

---

## 3. Filter ID Rotation on Update

### Problem

`gmail_update_filter` performs an atomic delete-and-recreate. The new filter gets a new ID, but the caller has no way to know this from the operation's semantics. This means:

1. Any cached filter ID becomes stale after an update.
2. The caller must re-fetch `gmail_account` to discover the new ID.
3. This adds an unnecessary round-trip after every filter update.

### Recommendation

**Option A (preferred):** Return the new filter ID prominently in the response:

```json
{
  "success": true,
  "previous_filter_id": "ANe1Bmj9Z2TeHeC1Azq3B4vugobGuzmgvJspYg",
  "new_filter_id": "ANe1BmkX7pQ2rL...",
  "retroactive": { "matched": 42, "modified": 42 }
}
```

**Option B (ideal but higher effort):** Implement stable filter IDs with a version field. The external ID stays the same across updates; an internal version tracks the underlying Gmail filter. This eliminates ID rotation entirely.

---

## 4. Label & Filter Context Enrichment

### Problem

`gmail_account` returns labels with total/unread counts, but lacks temporal context. When triaging 4,698 unread messages, knowing the count isn't enough — knowing the *distribution* across time is what enables prioritization.

Additionally, there's no visibility into which filters are associated with which labels, requiring the caller to manually cross-reference filter actions with label names.

### Recommendation

**4a. Unread age breakdown on labels:**

```json
{
  "id": "Label_11",
  "name": "Finance/USAA",
  "messages_total": 592,
  "messages_unread": 63,
  "unread_breakdown": {
    "last_30_days": 3,
    "31_to_90_days": 12,
    "91_to_365_days": 28,
    "over_365_days": 20
  }
}
```

This is computable with a few targeted `messages.list` calls using date ranges + `is:unread` + the label. It could be opt-in (e.g., `gmail_account({ include_unread_breakdown: true })`) to avoid the extra API cost on every call.

**4b. Filter-to-label association:**

On each label, include the filter IDs that target it:

```json
{
  "id": "Label_11",
  "name": "Finance/USAA",
  "associated_filters": ["ANe1Bmj9Z2TeHeC1Azq3B4vugobGuzmgvJspYg"],
  "filter_summary": "from:(@usaa.com) → add label, keep in inbox"
}
```

On each filter, include a human-readable summary:

```json
{
  "id": "ANe1Bmj9Z2TeHeC1Azq3B4vugobGuzmgvJspYg",
  "criteria_summary": "from:(@usaa.com)",
  "action_summary": "Label as Finance/USAA",
  "target_labels": ["Finance/USAA"]
}
```

This bidirectional linking eliminates the need for manual cross-referencing.

---

## 5. Search Param Improvements

### 5a. Bug Fix: `exclude_label` Not Filtering

**Severity: Bug**

During testing, `exclude_label: "CATEGORY_UPDATES"` combined with `label: "Finance/USAA"` returned identical results to the same query without `exclude_label`. Messages with `CATEGORY_UPDATES` in their label arrays were still included.

The query `label:Finance/USAA -label:CATEGORY_UPDATES after:2026/01/01` should be constructed, but the `-label:` operator may not be getting appended to the Gmail query string.

### 5b. Make Label Params Accept Arrays

Current: `label` and `exclude_label` are singular strings.

To search for messages matching multiple labels (e.g., "Finance/USAA AND CATEGORY_UPDATES") or excluding multiple labels, the caller must fall back to the raw `query` param, which defeats the purpose of structured params.

**Recommendation:** Accept arrays:

```json
{
  "labels": ["Finance/USAA", "INBOX"],
  "exclude_labels": ["CATEGORY_UPDATES", "CATEGORY_PROMOTIONS"]
}
```

This is a breaking change to the param names (`label` → `labels`, `exclude_label` → `exclude_labels`). Consider supporting both during a deprecation period.

**Note on `include_label`:** A separate `include_label` param is unnecessary — the existing `label` param already serves this function. The improvement is making it plural, not adding a synonym.

---

## 6. Search Response Noise — Fields to Trim or Restructure

### Problem

Search responses still carry redundant or low-signal fields that inflate token consumption without aiding triage or decision-making. Every unnecessary field compounds across result sets — a 31-message search with 3 redundant fields per message wastes ~93 fields worth of context window.

### 6a. `thread_message_counts` in Summary — Noisy When Uniform

When every thread in a result set is a single-message thread, the `thread_message_counts` map becomes pure noise:

```json
"thread_message_counts": {
  "19d7c223053629c3": 1,
  "19d53baa5227dfad": 1,
  "19d4e6221cdf12a3": 1,
  // ... 28 more entries, all ": 1"
}
```

This consumed 31 lines of output to convey zero information. The `message_count` field already exists on each thread object in the results.

**Recommendation:** Remove `thread_message_counts` from the summary entirely. It duplicates information already present on each thread in the `threads` array. If a summary-level signal is needed, replace with:

```json
"thread_depth": {
  "single_message": 28,
  "multi_message": 3,
  "deepest": { "thread_id": "19cb1e7edca3f55b", "count": 8 }
}
```

### 6b. `size_bytes` on Search Results — Wrong Tier

`size_bytes` appears on every matched message in search results. For triage (deciding which emails to read), message size is almost never a deciding factor. It belongs in `gmail_read` (Tier 2), not search (Tier 1).

**Recommendation:** Remove `size_bytes` from search `matched_messages`. Keep it on `gmail_read` responses where it's relevant (e.g., deciding whether to download attachments).

### 6c. Empty Arrays — Should Be Omitted Like Null Fields

Null-field omission is already working well (`reply_to` is absent when null). But empty arrays are still included:

```json
"cc": [],
"bcc": [],
"attachments": []
```

These carry no information. The same omission principle should apply.

**Recommendation:** Omit empty arrays. Their absence implies empty. If a caller needs to distinguish "no cc" from "cc unknown," a separate `has_cc` boolean would be more efficient than transmitting an empty array.

### 6d. Snippet Boilerplate — Low-Signal Prefixes

Many automated/transactional emails start their snippet with boilerplate:

```
"snippet": "To ensure delivery to your inbox, please add USAA.Customer.Service@mailcenter.usaa.com to your address book. USAA Logo USAA SECURITY ZONE Aaron Boehle USAA # ending in:7464 New Document for You Dear"
```

The first ~140 characters are delivery instructions and branding, not content. The actual subject matter ("New Document for You") doesn't appear until the end and often gets truncated.

**Recommendation:** This is a hard problem to solve generically, but two approaches could help:

1. Strip known boilerplate prefixes ("To ensure delivery to your inbox," "View this email on web," etc.) from snippet generation.
2. Use the email's `subject` as the primary signal for triage (already present), and truncate snippets to the first *meaningful* sentence rather than the first N characters.

### 6e. Summary `senders` Map — Inconsistent Keys

The `senders` map in the summary uses display names when available but falls back to raw email addresses:

```json
"senders": {
  "USAA": 24,
  "USAA Advice": 1,
  "usaapaybillscustomerservice@paybills.usaa.com": 3,
  "Juan C. Andrade, USAA CEO": 2,
  "USAA Rewards": 1
}
```

This mixes formats (`"USAA"` vs `"usaapaybillscustomerservice@paybills.usaa.com"`), making it harder to parse programmatically or reason about.

**Recommendation:** Normalize to structured objects:

```json
"senders": [
  { "name": "USAA", "email": "usaa.customer.service@mailcenter.usaa.com", "count": 24 },
  { "name": "USAA Advice", "email": "usaaadvice@mem.usaa.com", "count": 1 },
  { "name": null, "email": "usaapaybillscustomerservice@paybills.usaa.com", "count": 3 }
]
```

### 6f. `history_id` — Orphaned After Tool Removal

`history_id` appears on every `gmail_read` response. This field was useful when `gmail_get_history` existed for incremental sync, but that tool was removed in the consolidation. Without a consumer, it's dead weight.

**Recommendation:** Either remove `history_id` from responses, or re-introduce incremental sync capability that uses it. If the plan is to bring back history-based sync later, keep it but document why it's there.

### Summary of Noise Reduction

| Field | Location | Action | Token Savings |
|---|---|---|---|
| `thread_message_counts` | Search summary | Replace with `thread_depth` summary or remove | High (scales with result count) |
| `size_bytes` | Search matched_messages | Move to `gmail_read` only | Medium |
| `cc: []`, `bcc: []`, `attachments: []` | Read responses | Omit when empty | Low per field, adds up |
| Snippet boilerplate | Search matched_messages | Strip known prefixes | Medium |
| `senders` map | Search summary | Normalize to structured array | Low (readability gain) |
| `history_id` | Read responses | Remove or justify | Low |

**Estimated impact:** For a typical 30-message search result, these changes would reduce response size by roughly 25-35%, with the `thread_message_counts` removal and `size_bytes` removal accounting for the majority.

---

## 7. What's Working Well — Keep These Patterns

These design decisions received positive feedback and should be preserved:

**`gmail_modify` with query-based targeting:** Declarative intent ("mark all USAA emails as read") without requiring the caller to collect IDs, paginate, or batch. This is the right abstraction level for bulk operations.

**`gmail_update_filter` with retroactive application:** Collapsing filter update + apply-to-existing into one atomic call with a `retroactive.modified` count. The confirmation signal is exactly what's needed.

**`gmail_account` as a single comprehensive state dump:** Profile, labels (system/user/categories with counts and summary), all 19 filters, and settings (vacation, forwarding, IMAP, POP, send_as, delegates) in one call. Previously required 3+ separate calls.

**Structured search parameters:** `from`, `to`, `subject`, `before`, `after`, `has_attachment`, `filter_id`, `negated_query` are cleaner and less error-prone than raw query strings. The `filter_id` param for reusing existing filter criteria as search terms is particularly elegant.

**Thread-grouped search results:** The new response shape with `threads[].matched_messages[]`, `message_count` vs `matched_count`, `date_range`, and `participants` is a major improvement. Search is now genuinely Tier 1 (metadata-only triage).

**`gmail_read` with batch + thread context:** `message_ids` array (batch) returning `{message, thread}` pairs with a `position` field. Knowing "this is message 5 of 8" eliminates the need for a separate thread-level call.

**Null-field omission:** Fields like `reply_to` now only appear when non-null. Reduces noise significantly on search results.

---

## 8. Implementation Priority

| Priority | Item | Type | Effort |
|---|---|---|---|
| **P0** | Fix `exclude_label` bug | Bug fix | Low |
| **P1** | Pipelined fetch with concurrency control | Performance | Medium |
| **P1** | Actionable error messages (quota + batch) | UX | Medium |
| **P1** | Remove `thread_message_counts` from search summary | Noise reduction | Low |
| **P2** | Return new filter ID on update | UX | Low |
| **P2** | Plural label params (`labels`/`exclude_labels`) | Feature | Low |
| **P2** | Graceful truncation with `truncated` signal | UX | Low |
| **P2** | Move `size_bytes` to `gmail_read` only | Noise reduction | Low |
| **P2** | Omit empty arrays (`cc`, `bcc`, `attachments`) | Noise reduction | Low |
| **P2** | Normalize `senders` map to structured array | Noise reduction | Low |
| **P2** | Remove or justify orphaned `history_id` | Noise reduction | Low |
| **P3** | Unread age breakdown on labels | Feature | Medium |
| **P3** | Filter-to-label bidirectional linking | Feature | Medium |
| **P3** | Gmail API `fields` parameter for payload reduction | Performance | Low |
| **P3** | Strip boilerplate prefixes from snippets | Noise reduction | Medium |

---

## Appendix: Test Coverage Summary

**Tools tested:** `gmail_account`, `gmail_search` (12 param permutations), `gmail_read` (single, batch, include_html), `gmail_get_drafts` (metadata, with body)

**Regression status (P1-P4 from prior rounds):** All passing. P1 (HTML-only body extraction), P2 (HTML tags in plaintext), P3 (YELLOW_STAR label mapping), P4 (has_attachments metadata) — all fixed and stable across 5 rounds.

**New finding (P5):** Template placeholder leak — AA referral email has `[[CANDIDATE_FIRST_NAME]]` in `body_text` but rendered values in `body_html`. The `text/plain` MIME part contains unrendered template tokens. This is an upstream sender issue but argues for keeping `include_html` as an option, or implementing fallback logic that detects placeholder patterns and extracts from HTML instead.
