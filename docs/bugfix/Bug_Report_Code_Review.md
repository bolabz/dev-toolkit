# Bug Report: Gmail Toolkit Code Review

**Date**: 2026-04-08
**Scope**: Full `src/` codebase review across all three architectural layers
**Overall Quality Rating**: 6.5 / 10
**Status**: P0 issues fixed; remaining issues documented for dedicated efforts

---

## Issue Distribution Summary

| Category                 | Count | %   | Severity Breakdown           |
| ------------------------ | ----- | --- | ---------------------------- |
| Error Handling           | 6     | 25% | 2 Major, 4 Moderate          |
| Validation & Type Safety | 6     | 25% | 3 Major, 3 Minor             |
| Design & Architecture    | 6     | 25% | 1 Major, 3 Moderate, 2 Minor |
| Bugs (Runtime Defects)   | 2     | 8%  | 2 Critical (**FIXED**)       |
| Performance              | 2     | 8%  | 1 Major, 1 Moderate          |
| Security                 | 2     | 8%  | 2 Moderate                   |

---

## 1. BUGS (Runtime Defects)

### Critical

#### BUG-C1: Rate Limiter Not Shared Across Resource Clients [FIXED]

- **File**: `src/client/base.ts:32-34`, `src/client/index.ts:27-34`
- **Confidence**: 10/10
- **Status**: **FIXED** — shared PQueue now injected from `GmailClient`
- **Problem**: `GmailClientBase` constructor creates a new `PQueue` per instance (`this.queue = new PQueue(RATE_LIMIT_CONFIG)`). `GmailClient` instantiates 7 sub-clients (`MessagesClient`, `ThreadsClient`, `LabelsClient`, `DraftsClient`, `FiltersClient`, `SettingsClient`, `HistoryClient`), each inheriting their own queue. This creates 7 independent rate limiters, each allowing 50 req/sec → up to 350 req/sec combined, exceeding Gmail's 250 quota units/sec limit.
- **Impact**: Under concurrent operations across different resource types (e.g., search + label resolution + thread reads), Gmail API returns 429 rate limit errors that appear random and are difficult to diagnose. Low-volume usage is unaffected, making this a production-only bug.
- **Fix Applied**: `GmailClient` now creates a single `PQueue` and injects it into all sub-clients via a new `sharedQueue` parameter on `GmailClientBase`.

#### BUG-C2: `gmail_send_message` MCP Handler Drops `content_type` and `thread_id` [FIXED]

- **File**: `src/mcp-server.ts:326-328` → `src/composed/destructive.ts:153-163`
- **Confidence**: 10/10
- **Status**: **FIXED** — explicit snake→camel mapping added
- **Problem**: The MCP handler passed raw params (snake_case: `content_type`, `thread_id`) directly to `sendMessage()`, which expects camelCase (`contentType`, `threadId`). The `createDraft` handler at line 256 correctly maps these — `sendMessage` did not.
- **Impact**: HTML email sends via MCP always rendered as plain text. Threaded replies via MCP created new threads instead of replying. Both `content_type` and `thread_id` were silently ignored. Basic sends (plain text, no threading) worked correctly, masking the bug.
- **Fix Applied**: Added explicit parameter mapping matching the `createDraft` pattern.

---

## 2. ERROR HANDLING (Missing / Inconsistent)

### Major

#### ERR-M1: No Error Handling in Any MCP Tool Handler (20 handlers)

- **File**: `src/mcp-server.ts`, lines 72-404 (all `server.tool()` registrations)
- **Confidence**: 9/10
- **Problem**: None of the 20 registered tool handlers wrap their composed function calls in try/catch. If a composed function throws (API rate limit, network failure, invalid input), the error propagates unhandled to the MCP transport layer, producing an opaque error with no user guidance.
- **Impact**: MCP clients (Claude Desktop, etc.) receive generic error messages with no indication of whether the error is transient (retry), a user input issue (fix query), or a systemic failure (re-authenticate). This directly degrades the AI assistant's ability to recover from errors.
- **Suggested Fix**: Create a shared handler wrapper that catches errors and returns structured `{ isError: true, content: [{ type: 'text', text: 'Error: ...' }] }` responses. This is a ~30 minute effort touching one file.
  ```typescript
  function wrapHandler<T>(fn: (params: T) => Promise<unknown>) {
    return async (params: T) => {
      try {
        const result = await fn(params);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    };
  }
  ```
- **Regression Risk**: None — adds handling where none exists.

#### ERR-M2: Inconsistent Error Strategy Across Layer 2 (4 different patterns)

- **Files**: Multiple composed files
- **Confidence**: 8/10
- **Problem**: Layer 2 uses four mutually incompatible error handling patterns:
  1. **Swallow and return empty** — `src/composed/account.ts:26`: `.catch(() => [])` silently discards delegate list errors
  2. **Catch and return error object** — `src/composed/destructive.ts:80-88`: Returns `{ deleted: false, message: "..." }` with error detail
  3. **Catch and return empty array** — `src/composed/readers.ts:76-78`: Returns `labelContext = []` on failure
  4. **Catch and fall back silently** — `src/composed/body-processing.ts:199-200`: Returns unmodified text on parse failure
- **Impact**: Callers cannot reliably distinguish between "operation returned empty results" and "operation failed silently." This makes debugging extremely difficult — an empty delegate list might mean "no delegates" or "insufficient OAuth scopes."
- **Suggested Fix**: Standardize on two patterns: (1) read operations throw on failure, (2) write/destructive operations return `{ success, errors }`. Adopt incrementally — start with the most confusing case (`account.ts` swallowing scope errors).
- **Regression Risk**: Moderate — callers currently expecting swallowed errors would need to add try/catch. Should be done per-file with corresponding test coverage.

### Moderate

#### ERR-Mod1: Silent Catch in `stripReplyChain` Hides Reply Parser Failures

- **File**: `src/composed/body-processing.ts:194-202`
- **Confidence**: 8/10
- **Problem**: `stripReplyChain()` has a bare `catch { return text; }` that swallows all errors from the reply parser, including module loading failures. If `email-reply-parser` fails to install or has a breaking API change, reply stripping silently stops working — users see full quoted reply chains with no indication that parsing failed.
- **Impact**: Users may believe replies are being stripped when they aren't, leading to bloated context in AI conversations. No log message or metric indicates the failure.
- **Suggested Fix**: Log a warning on first failure, then cache the failure state to avoid repeated logging:
  ```typescript
  catch (err) {
    if (!replyParserWarned) {
      console.warn('Reply parser unavailable, returning unmodified text:', err);
      replyParserWarned = true;
    }
    return text;
  }
  ```
- **Regression Risk**: None — behavior unchanged, just adds visibility.

#### ERR-Mod2: Silent `.catch(() => [])` in `getAccount` Hides Scope Errors

- **File**: `src/composed/account.ts:26`
- **Confidence**: 8/10
- **Problem**: `client.settings.listDelegates().catch(() => [])` swallows all errors. The comment "May fail without delegate scope" explains the intent, but the implementation also swallows network errors, rate limits, and other transient failures.
- **Impact**: If delegate listing fails for any reason, the `delegates` array is silently empty. Users cannot tell if they have no delegates or if the API call failed.
- **Suggested Fix**: Catch specifically for 403/scope errors; re-throw other errors:
  ```typescript
  client.settings.listDelegates().catch((err) => {
    if (err?.code === 403 || err?.status === 403) return [];
    throw err;
  });
  ```
- **Regression Risk**: Low — only changes behavior for non-403 errors, which are currently silently swallowed.

#### ERR-Mod3: Silent Label Fetch Failure in `deleteLabel`

- **File**: `src/composed/destructive.ts:58-65`
- **Confidence**: 7/10
- **Problem**: Before deleting a label, the code fetches label details (name, counts) for the user-facing response. If `client.labels.get(id)` fails, the empty catch block at line 63 silently proceeds with deletion using placeholder values (`labelName = nameOrId`, `messagesAffected = 0`).
- **Impact**: The deletion response may report "Deleted empty label X" when label X actually had thousands of messages. The label is still deleted — the error only affects reporting accuracy.
- **Suggested Fix**: Log the fetch failure or include a note in the response message that counts could not be verified.
- **Regression Risk**: None — deletion behavior unchanged.

#### ERR-Mod4: `execute()` Method Provides No Error Context

- **File**: `src/client/base.ts:40-42`
- **Confidence**: 7/10
- **Problem**: The `execute()` method wraps all API calls through the rate limiter but provides no error context. If a Gmail API call fails, the error bubbles up from p-queue with no indication of which resource client, endpoint, or parameters triggered it. A timeout error from p-queue looks identical to a Gmail API error.
- **Impact**: Production debugging is harder — error logs show "Request failed" with no context about what was attempted. With a shared rate limiter, timeout errors are now more likely under concurrent load.
- **Suggested Fix**: Add an optional operation descriptor parameter:
  ```typescript
  protected async execute<T>(fn: () => Promise<T>, operation?: string): Promise<T> {
    try {
      return await this.queue.add(fn, { throwOnTimeout: true }) as Promise<T>;
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        throw new Error(`Rate limiter timeout during ${operation ?? 'API call'}`);
      }
      throw error;
    }
  }
  ```
- **Regression Risk**: Low — existing callers don't pass the optional param; behavior unchanged unless operation is specified.

---

## 3. VALIDATION & TYPE SAFETY (Missing Guards)

### Major

#### VAL-M1: No Input Validation on MCP Tool String Parameters

- **File**: `src/mcp-server.ts` (all Zod schema definitions)
- **Confidence**: 9/10
- **Problem**: Required string parameters across all 20 tools use bare `z.string()` without `.min(1)` or `.nonempty()`. Key examples:
  - Line 76: `query: z.string()` — allows empty search query
  - Line 93: `message_id: z.string()` — allows empty message ID
  - Line 318-320: `to`, `subject`, `body` — all allow empty strings for email sending
  - Line 337: `message_ids: z.array(z.string())` — allows array of empty strings
- **Impact**: Empty strings propagate to the Gmail API, which returns confusing 400 errors (e.g., "Invalid message ID: "). Users must reverse-engineer that the issue was an empty parameter.
- **Suggested Fix**: Add `.min(1, 'Field cannot be empty')` to all required string params. For array params, add `.nonempty()` on the array and `.min(1)` on items:
  ```typescript
  query: z.string().min(1, 'Search query cannot be empty'),
  message_id: z.string().min(1, 'Message ID is required'),
  message_ids: z.array(z.string().min(1)).min(1, 'At least one message ID required'),
  ```
- **Regression Risk**: None — empty strings never produce valid results today.

#### VAL-M2: Non-Null Assertions on Optional Gmail API Fields

- **Files**:
  - `src/client/messages.ts:43-44` — `m.id!`, `m.threadId!`
  - `src/client/threads.ts:38` — `t.id!`
  - `src/client/drafts.ts:28` — `d.id!`
- **Confidence**: 8/10
- **Problem**: The `!` (non-null assertion) operator tells TypeScript "trust me, this is not null/undefined." The googleapis types mark these fields as optional (`id?: string | null`), but the code asserts they exist without runtime verification. If the Gmail API ever returns a response missing these fields (API bug, partial response, network corruption), `undefined` silently propagates as a string through the entire system.
- **Impact**: Downstream code receives `undefined` where it expects a string ID. This could cause silent data corruption (e.g., storing `undefined` as a key) or cryptic errors far from the source (e.g., "Cannot read properties of undefined" in an unrelated function).
- **Suggested Fix**: Filter out entries missing required fields:
  ```typescript
  messages: (response.data.messages ?? [])
    .filter((m): m is typeof m & { id: string; threadId: string } => !!m.id && !!m.threadId)
    .map((m) => ({ id: m.id, threadId: m.threadId })),
  ```
- **Regression Risk**: Low — filters out malformed entries instead of crashing. Callers may receive fewer results, but all returned results are valid.

#### VAL-M3: Empty String Fallbacks Mask Missing Required Data

- **Files**:
  - `src/client/history.ts:38` — `historyId: response.data.historyId ?? ''`
  - `src/client/drafts.ts:29` — `messageId: d.message?.id ?? ''`
  - `src/composed/search.ts:84-85` — `id: raw.id ?? ''`, `thread_id: raw.threadId ?? ''`
  - `src/composed/readers.ts:126-127` — `id: raw.id ?? ''`, `thread_id: raw.threadId ?? ''`
- **Confidence**: 8/10
- **Problem**: Using `?? ''` for fields that should never be empty (like `id`, `historyId`) makes it impossible for callers to distinguish "field was absent" from "field is legitimately empty." An empty `id` passed to `messages.get('')` causes a Gmail API 400 error.
- **Impact**: Cascading failures. An empty `historyId` passed to `history.list()` triggers an API error. An empty message `id` passed to `readMessage()` triggers an API error. In both cases, the root cause (missing field in upstream response) is hidden behind a downstream error.
- **Suggested Fix**: For required fields, throw on absence. For optional fields, use `null` instead of `''`:

  ```typescript
  // Required field — fail fast
  historyId: response.data.historyId ?? (() => { throw new Error('API returned history without historyId'); })(),

  // Optional field — use null to signal absence
  messageId: d.message?.id ?? null,
  ```

- **Regression Risk**: Low for `null` approach. Moderate for throwing approach — callers need to handle the error. Recommend starting with `null` for optional fields and throwing only for truly required fields like `historyId`.

### Minor

#### VAL-m1: `ReplyParserClass: any` Type Bypasses Type Safety

- **File**: `src/composed/body-processing.ts:22-23`
- **Confidence**: 9/10
- **Problem**: `let ReplyParserClass: any;` with an eslint-disable comment. The CJS module's export shape is unknown at compile time, so `any` is used as a workaround.
- **Impact**: If `email-reply-parser` changes its API (e.g., renames `parseReply` to `parse`), the error only appears at runtime. TypeScript provides no compile-time protection.
- **Suggested Fix**: Define a typed interface:
  ```typescript
  interface ReplyParser {
    parseReply(text: string): string;
  }
  let ReplyParserClass: (new () => ReplyParser) | null = null;
  ```
- **Regression Risk**: None — purely additive type annotation.

#### VAL-m2: No Input Validation in Layer 1 Methods

- **Files**: All `src/client/*.ts` files
- **Confidence**: 8/10
- **Problem**: Layer 1 methods accept parameters without validation. Passing empty strings, null, or invalid values to methods like `messages.get('')` or `labels.delete('')` propagates to the Gmail API, which returns unclear error messages.
- **Impact**: Layer 2 usually passes valid data, so this is primarily a risk for direct library consumers. Invalid inputs produce confusing Gmail API errors rather than clear validation messages.
- **Suggested Fix**: Add guards for critical parameters at public method boundaries:
  ```typescript
  async get(id: string, ...): Promise<...> {
    if (!id) throw new Error('Message ID is required');
    // ...
  }
  ```
- **Regression Risk**: None — invalid inputs currently fail anyway, just with worse error messages.

#### VAL-m3: MCP Prompt Parameters Not Validated

- **File**: `src/mcp-server.ts:446-528` (all `server.prompt()` definitions)
- **Confidence**: 5/10
- **Problem**: Prompt parameters like `days` are typed as `z.string().optional()` but interpolated directly into prompt text. Passing `days = "abc"` produces `"Search for unread messages from the last abc days"` — syntactically valid but semantically nonsensical.
- **Impact**: Low — prompts are consumed by LLMs that may still interpret the intent correctly. But it's sloppy.
- **Suggested Fix**: Add regex validation: `days: z.string().regex(/^\d+$/, 'Days must be a number').optional()`
- **Regression Risk**: None — rejects inputs that currently produce nonsensical prompts.

---

## 4. DESIGN & ARCHITECTURE

### Major

#### DES-M1: Tight Coupling to `LabelCache` Concrete Class

- **Files**: All `src/composed/` read operations (`search.ts`, `readers.ts`, `drafts.ts`, `filters.ts`)
- **Confidence**: 8/10
- **Problem**: Every composed read function accepts `labelCache: LabelCache` as a parameter — a concrete class that requires a live `GmailClient` to instantiate. This means:
  1. Unit testing composed functions requires a real `LabelCache` with a real `GmailClient`
  2. Alternative caching strategies (Redis, TTL-based, preloaded) cannot be substituted
  3. The 45 test stubs are likely stubs _because_ these dependencies are hard to mock
- **Impact**: Low testability contributes to the codebase having 0% test coverage (45 stubs, 0 implemented). This is the single biggest barrier to writing reliable tests.
- **Suggested Fix**: Extract a `LabelResolver` interface:
  ```typescript
  interface LabelResolver {
    resolve(ids: string[]): Promise<string[]>;
    lookup(name: string): Promise<string | null>;
    lookupMany(names: string[]): Promise<string[]>;
    invalidate(): void;
  }
  ```
  Have `LabelCache` implement it. Change all composed functions to accept `LabelResolver`.
- **Regression Risk**: None — purely additive interface extraction. `LabelCache` continues to work identically.

### Moderate

#### DES-Mod1: Duplicate Message Transformation Logic

- **Files**: `src/composed/search.ts:54-100` vs `src/composed/readers.ts:109-143`
- **Confidence**: 9/10
- **Problem**: Both files independently transform raw Gmail messages with overlapping logic:
  - Header extraction into a Map
  - Label ID resolution via cache
  - Contact parsing (from, to, cc)
  - Unread/starred detection from label IDs
  - Body processing pipeline invocation
  - Web URL generation

  The `readers.ts` file has a cleaner `transformMessage()` function, while `search.ts` inlines the logic.

- **Impact**: A bug fix in one location may be missed in the other. The existing `transformMessage()` in `readers.ts` already solves this — `search.ts` should reuse it (with minor adaptation for the `MessageSummary` type).
- **Suggested Fix**: Export `transformMessage` from `readers.ts` (or extract to `helpers.ts`) and import in `search.ts`. The type difference (`MessageSummary` vs `FullMessage`) can be handled by the shared function returning `FullMessage` and `search.ts` projecting it to `MessageSummary`.
- **Regression Risk**: Low — pure refactor of existing logic.

#### DES-Mod2: Module-Level MCP Tool Registration Creates Tight Coupling

- **File**: `src/mcp-server.ts:71-404`
- **Confidence**: 7/10
- **Problem**: 20 `if (isEnabled('tool_name'))` blocks at module level, each containing inline handler logic. Adding a new tool requires editing `mcp-server.ts` (handler), `config/tools.ts` (registry entry), and the composed function file. All composed functions are imported unconditionally, even for disabled tools.
- **Impact**: Maintenance burden grows linearly with tool count. No way to add a tool without touching the monolithic server file. All imports execute at startup regardless of enabled state.
- **Suggested Fix**: Create a tool definition pattern where each tool is self-contained:
  ```typescript
  const toolDefs = {
    gmail_search: {
      schema: { query: z.string(), ... },
      handler: async (params) => search(client, labelCache, params.query, ...),
    },
  };
  for (const [name, def] of Object.entries(toolDefs)) {
    if (isEnabled(name)) server.tool(name, toolRegistry[name].description, def.schema, def.handler);
  }
  ```
- **Regression Risk**: Low — structural refactor only, no behavioral change.

#### DES-Mod3: Inconsistent Parameter Naming (camelCase vs snake_case)

- **Files**: `src/index.ts`, `src/mcp-server.ts`, `src/composed/labels.ts:205`
- **Confidence**: 7/10
- **Problem**: The codebase inconsistently mixes naming conventions:
  - **MCP layer**: snake_case (correct per MCP convention) — `content_type`, `thread_id`, `max_results`
  - **Composed layer**: camelCase (correct per TypeScript convention) — `contentType`, `threadId`, `maxResults`
  - **GmailToolkit class** (`index.ts`): Mixed — `new_name` in `updateLabel` (line ~137) is snake_case in a TypeScript API
  - **Response types** (`types.ts`): snake_case — `body_text`, `is_unread`, `message_id`

  The MCP→composed boundary should be the translation point, but `index.ts` introduces snake_case into the TypeScript API.

- **Impact**: Developers using the library directly must remember which convention each method uses. The `BUG-C2` fix was necessary specifically because this boundary wasn't clean.
- **Suggested Fix**: Standardize: TypeScript internals (composed functions, `GmailToolkit` class) use camelCase. MCP server translates at the boundary. Response types can remain snake_case since they serialize to JSON for MCP consumption.
- **Regression Risk**: Moderate — changing `new_name` to `newName` in `updateLabel` is a public API change. Should be done in a dedicated effort with changelog.

#### DES-Mod4: Manual Cache Invalidation Is Error-Prone

- **Files**: `src/composed/labels.ts:181,219`, `src/composed/destructive.ts:69`
- **Confidence**: 7/10
- **Problem**: After label mutations (create, update, delete), code manually calls `labelCache.invalidate()`. A future developer adding a new label mutation could forget this call, causing stale cached label names in responses.
- **Impact**: Stale label names in search results, thread reads, and filter descriptions. Users see old label names after renaming or creating labels.
- **Suggested Fix**: Observer pattern — label mutation methods in the composed layer auto-invalidate:
  ```typescript
  // In LabelCache
  wrapMutation<T>(fn: () => Promise<T>): Promise<T> {
    const result = await fn();
    this.invalidate();
    return result;
  }
  ```
- **Regression Risk**: Low — invalidation happens more reliably, not differently.

### Minor

#### DES-m1: `paginate()` Has No Truncation Indicator

- **File**: `src/client/base.ts:62-80`
- **Confidence**: 6/10
- **Problem**: The `paginate()` method defaults to `maxPages = 50` and silently stops. When truncated, callers receive partial results with no indication that more data exists.
- **Impact**: Low — `paginate()` is currently only used internally, and 50 pages covers most use cases. But if used for large mailboxes, results are silently incomplete.
- **Suggested Fix**: Return `{ items, truncated: boolean }` instead of just `TItem[]`.
- **Regression Risk**: Moderate — changes the return type signature. All callers need updating.

#### DES-m2: Inconsistent `maxResults` Defaults Across Resources

- **Files**: `src/client/messages.ts:34` (20), `src/client/threads.ts:29` (20), `src/client/drafts.ts:20` (10)
- **Confidence**: 7/10
- **Problem**: Different resource clients have different default `maxResults` values (10 for drafts, 20 for messages and threads) with no documented rationale.
- **Impact**: Inconsistent behavior when switching between resources. A user expecting 20 drafts gets 10 by default.
- **Suggested Fix**: Either document the rationale or extract to named constants with explanations.
- **Regression Risk**: None if only adding documentation. Low if aligning defaults.

#### DES-m3: Magic Numbers Without Named Constants

- **Files**: `src/composed/helpers.ts:162` (100_000), `src/composed/body-processing.ts` (various thresholds)
- **Confidence**: 8/10
- **Problem**: Numeric literals appear inline without named constants or documentation:
  - `100_000` — 100KB threshold for metadata-format attachment detection heuristic
  - Various body processing thresholds
- **Impact**: Developers modifying these values must understand the context from surrounding code rather than a named constant.
- **Suggested Fix**: Extract to named constants:
  ```typescript
  const METADATA_ATTACHMENT_SIZE_THRESHOLD = 100_000; // 100KB
  ```
- **Regression Risk**: None — pure refactor.

---

## 5. SECURITY

### Moderate

#### SEC-Mod1: RFC 2822 Header Injection via String Concatenation

- **File**: `src/composed/destructive.ts:165-173`
- **Confidence**: 7/10
- **Problem**: The `sendMessage` function builds RFC 2822 headers by direct string concatenation:
  ```typescript
  const lines: string[] = [`To: ${options.to}`, `Subject: ${options.subject}`];
  if (options.cc) lines.push(`Cc: ${options.cc}`);
  if (options.bcc) lines.push(`Bcc: ${options.bcc}`);
  ```
  If `options.to` contains CRLF characters (`\r\n`), an attacker could inject additional headers (e.g., inject a BCC to exfiltrate email content).
- **Impact**: In the MCP context, the LLM constructs these values — not end users — so the attack surface is prompt injection rather than traditional input injection. An adversarial email body could trick the LLM into injecting headers. Risk is moderate because: (1) Gmail's API may strip injected headers server-side, and (2) the MCP tool is behind user approval.
- **Suggested Fix**: Sanitize CRLF from all header values:
  ```typescript
  function sanitizeHeader(value: string): string {
    return value.replace(/[\r\n]/g, '');
  }
  lines.push(`To: ${sanitizeHeader(options.to)}`);
  ```
- **Regression Risk**: None — only strips characters that are invalid in single-line headers.

#### SEC-Mod2: Same Header Injection in `buildRfc2822Message` (Drafts)

- **File**: `src/composed/drafts.ts:108-125`
- **Confidence**: 7/10
- **Problem**: Identical vulnerability to SEC-Mod1. The `buildRfc2822Message()` function in drafts uses the same unsanitized string concatenation pattern for To, Cc, Bcc, and Subject headers.
- **Impact**: Same as SEC-Mod1, but for draft creation rather than direct sending. Drafts are not sent immediately, so the user would see the malformed draft before sending — reducing practical risk.
- **Suggested Fix**: Extract a shared `sanitizeHeader()` utility and apply to both files.
- **Regression Risk**: None.

---

## 6. PERFORMANCE

### Major

#### PERF-M1: Sequential Label Resolution in Search Hot Path

- **File**: `src/composed/search.ts:54-58`
- **Confidence**: 9/10
- **Problem**: The search loop calls `await labelCache.resolve(labelIds)` once per message at line 58, inside a `for...of` loop starting at line 54. With 20 messages, this creates 20 sequential async hops. While the cache is O(1) after initial load, each `await` still creates a microtask, and `ensureLoaded()` is invoked 20 times (returning early after the first).
  - Note: `src/composed/readers.ts:47-53` has the same pattern in `readThread`, calling `await transformMessage()` (which calls `labelCache.resolve()`) per message.
- **Impact**: Search is the dominant operation (~80% of reads per the spec). The sequential awaits add unnecessary latency — especially noticeable with `includeBody = true`, where body processing compounds the per-message delay. Pre-resolving all labels in a single batch call would eliminate this overhead.
- **Suggested Fix**: Collect all unique label IDs across all messages, resolve once, then map in the loop:

  ```typescript
  // Collect all unique label IDs
  const allLabelIds = new Set<string>();
  for (const raw of rawMessages) {
    for (const id of raw.labelIds ?? []) allLabelIds.add(id);
  }
  const resolvedMap = new Map<string, string>();
  const resolved = await labelCache.resolve(Array.from(allLabelIds));
  Array.from(allLabelIds).forEach((id, i) => resolvedMap.set(id, resolved[i]));

  // Then in the loop:
  const resolvedLabels = labelIds.map((id) => resolvedMap.get(id) ?? id);
  ```

- **Regression Risk**: Low — same labels resolved, just batched. The cache's `ensureLoaded()` is called once instead of N times.

### Moderate

#### PERF-Mod1: `Promise.all()` in `batchExecute` Discards All Results on Single Failure

- **File**: `src/client/base.ts:53-57`
- **Confidence**: 7/10
- **Problem**: `batchExecute()` uses `Promise.all()`, which rejects immediately on the first failed request. A batch of 50 messages where one ID is invalid causes all 49 successful results to be discarded.
- **Impact**: In real-world Gmail usage, batch operations commonly encounter deleted messages, moved threads, or expired draft IDs. A single stale ID in a search result causes the entire `batchGet` to fail, even though 19 of 20 messages are perfectly valid.
- **Suggested Fix**: Add an opt-in `Promise.allSettled()` mode:
  ```typescript
  protected async batchExecute<T>(
    fns: Array<() => Promise<T>>,
    options?: { continueOnError?: boolean },
  ): Promise<(T | Error)[]> {
    if (options?.continueOnError) {
      const results = await Promise.allSettled(fns.map(fn => this.execute(fn)));
      return results.map(r => r.status === 'fulfilled' ? r.value : r.reason);
    }
    return Promise.all(fns.map(fn => this.execute(fn)));
  }
  ```
- **Regression Risk**: None if opt-in. Default behavior is unchanged.

---

## Recommended Work Streams

Based on the issue distribution, these are the recommended dedicated efforts in priority order:

### 1. Error Handling Hardening (6 issues)

**Issues**: ERR-M1, ERR-M2, ERR-Mod1, ERR-Mod2, ERR-Mod3, ERR-Mod4
**Effort**: ~4-6 hours
**Impact**: Transforms debugging experience for MCP users and library consumers
**Start with**: ERR-M1 (MCP handler wrapper) — highest impact, lowest risk

### 2. Input Validation & Type Safety (6 issues)

**Issues**: VAL-M1, VAL-M2, VAL-M3, VAL-m1, VAL-m2, VAL-m3
**Effort**: ~3-4 hours
**Impact**: Fail-fast at boundaries prevents confusing downstream errors
**Start with**: VAL-M1 (Zod `.min(1)`) — quick win across all MCP tools

### 3. Design & Architecture Cleanup (6 issues)

**Issues**: DES-M1, DES-Mod1, DES-Mod2, DES-Mod3, DES-Mod4, DES-m1, DES-m2, DES-m3
**Effort**: ~6-8 hours
**Impact**: Unlocks testability (DES-M1), reduces maintenance burden
**Start with**: DES-M1 (LabelResolver interface) — unblocks test implementation

### 4. Security Fixes (2 issues)

**Issues**: SEC-Mod1, SEC-Mod2
**Effort**: ~1 hour
**Impact**: Closes header injection vector in email send/draft
**Start with**: Extract shared `sanitizeHeader()` utility, apply to both files

### 5. Performance Optimization (2 issues)

**Issues**: PERF-M1, PERF-Mod1
**Effort**: ~2 hours
**Impact**: Reduces search latency, improves batch resilience
**Start with**: PERF-M1 (batch label resolution) — affects the most-used operation
