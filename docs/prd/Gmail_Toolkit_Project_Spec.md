# Gmail Toolkit — Project Specification

**Language:** TypeScript / Node.js
**Date:** April 7, 2026
**Version:** 2.1 — Seamless auth flow, prerequisites guide
**Status:** Pre-implementation — all design decisions finalized

---

## 1. Project Overview

A three-layer TypeScript toolkit for comprehensive Gmail management, designed for two primary use cases: as a custom MCP server for Claude Desktop (or any MCP-compatible LLM host), and as a programmatic library importable into other TypeScript/Node.js projects.

### Design Principles

- **Structured, noise-free responses** — no raw HTML, no unresolved label IDs, no duplicate fields, no tracking URLs, no quoted reply chains
- **Aggregated reads, granular writes** — reads combine API calls and resolve references to minimize tool calls; writes are precise single-intent operations
- **Non-destructive by default** — the MCP server only exposes reversible operations out of the box; destructive operations are pre-built but disabled, opt-in via configuration
- **Library-first** — the toolkit works as a standalone TypeScript library; the MCP server is a thin consumer of the composed operations layer
- **Configuration-driven tool registry** — all tools are pre-defined in Layers 1 and 2; Layer 3 enables/disables them via a config file, making it trivial to expose or remove tools in the future

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: MCP Server                                    │
│  Configuration-driven tool registry                     │
│  13 tools enabled + 7 disabled by default               │
│  2 resources + 5 prompts                                │
│  Thin wrapper: Zod schemas → composed operations        │
│  File: src/mcp-server.ts + src/config/tools.ts          │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Composed Operations                           │
│  Aggregated reads with label resolution + body cleanup  │
│  Granular writes with label name → ID resolution        │
│  Body processing pipeline (reply stripping, HTML → text)│
│  Pre-computed summary analytics on search results       │
│  Files: src/composed/*.ts                               │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Gmail Client                                  │
│  1:1 with Gmail API v1 endpoints                        │
│  Auth, pagination, batching, rate limiting               │
│  Files: src/client/*.ts                                 │
└─────────────────────────────────────────────────────────┘
```

### Entry Points

| Interface                   | Consumer                       | How It's Used                                                                           |
| --------------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| **MCP Server**              | Claude Desktop / any MCP host  | Runs as a child process via `npx gmail-toolkit --mcp`; communicates over stdio          |
| **Library import**          | Other TypeScript/Node projects | `import { GmailToolkit } from 'gmail-toolkit'` — direct function calls in-process       |
| **Setup script** (optional) | Human (pre-auth or testing)    | `npx tsx scripts/setup-auth.ts` — pre-authenticates before configuring MCP or deploying |

There is no CLI. Auth is seamless — on first use (in any mode), the browser opens for Google consent and the token is saved automatically. Subsequent uses are silent. The setup script exists only as an optional convenience. Destructive operations that aren't exposed in the MCP layer are available via library import for any developer who needs them programmatically. For one-off destructive actions (trash, delete, send), the Gmail web UI is the better interface.

---

## 3. Prerequisites: Obtaining Google OAuth Credentials

Before using the Gmail Toolkit (in any mode), you need a `credentials.json` file from Google Cloud Console. This is a one-time setup that takes ~5 minutes. The same credentials file works across all machines and modes indefinitely.

### Step-by-Step Setup

1. **Create or select a Google Cloud project**
   https://console.cloud.google.com/projectcreate

2. **Enable the Gmail API**
   https://console.cloud.google.com/apis/library/gmail.googleapis.com

3. **Configure the OAuth consent screen**
   https://console.cloud.google.com/apis/credentials/consent
   - Select "External" user type (or "Internal" if using Google Workspace)
   - Fill in the required fields (app name, support email)
   - Add scopes: `gmail.modify`, `gmail.compose`, `gmail.settings.basic`
   - Add your Google account as a test user (required while app is in "Testing" status)

4. **Create an OAuth Client ID**
   https://console.cloud.google.com/apis/credentials/oauthclient
   - Application type: **Desktop app**
   - Name: anything (e.g., "Gmail Toolkit")

5. **Download the credentials JSON**
   - Click the download icon next to the newly created client
   - Save the file as `credentials.json` in your project root (this path is configurable)

> **Note:** If `credentials.json` is missing when the toolkit initializes, it throws a clear error with these exact links so you don't need to memorize them.

---

## 4. Authentication

### OAuth 2.0 Configuration

| Property           | Value                                                     |
| ------------------ | --------------------------------------------------------- |
| Flow               | Installed App (Desktop) via `google-auth-library`         |
| Scopes             | `gmail.modify`, `gmail.compose`, `gmail.settings.basic`   |
| Token storage      | Local `token.json` file (gitignored)                      |
| Credentials source | `credentials.json` from Google Cloud Console (gitignored) |
| Token refresh      | Automatic — silent refresh when access token expires      |
| PKCE               | Enabled by default                                        |

### Scope Rationale

| Scope                  | Grants                                                                 | Does NOT Grant                     |
| ---------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| `gmail.modify`         | Read all mail, modify labels on messages/threads, create/delete labels | Send, permanently delete, settings |
| `gmail.compose`        | Create/update/send drafts                                              | Direct message send without draft  |
| `gmail.settings.basic` | Manage filters, read forwarding/vacation/IMAP/POP                      | Manage delegates                   |

### Request Headers (Every API Call)

```
Authorization: Bearer {access_token}
Accept: application/json
Content-Type: application/json    // POST/PUT/PATCH only
```

### Seamless Auth Flow (`src/auth.ts`)

Authentication is handled transparently by a single `ensureAuthenticated()` function. Both the library and MCP server call this same function — no separate setup script required.

```typescript
// src/auth.ts — core auth logic (simplified)

async function ensureAuthenticated(
  credentialsPath: string,
  tokenPath: string,
): Promise<OAuth2Client> {
  // 1. credentials.json MUST exist — cannot be auto-generated
  if (!fs.existsSync(credentialsPath)) {
    // Open browser to Google Cloud Console as a convenience
    await open('https://console.cloud.google.com/apis/credentials/oauthclient');
    throw new Error(
      `OAuth credentials not found at ${path.resolve(credentialsPath)}\n\n` +
        `To set up credentials (one-time, ~5 minutes):\n` +
        `1. Create a Google Cloud project:      https://console.cloud.google.com/projectcreate\n` +
        `2. Enable the Gmail API:               https://console.cloud.google.com/apis/library/gmail.googleapis.com\n` +
        `3. Configure OAuth consent screen:     https://console.cloud.google.com/apis/credentials/consent\n` +
        `4. Create OAuth Client ID (Desktop):   https://console.cloud.google.com/apis/credentials/oauthclient\n` +
        `5. Download JSON and save to:          ${path.resolve(credentialsPath)}`,
    );
  }

  const oauth2 = createOAuth2Client(credentialsPath);

  // 2. Token exists? Try to use it.
  if (fs.existsSync(tokenPath)) {
    oauth2.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf-8')));
    try {
      await oauth2.getAccessToken(); // forces refresh if expired
      return oauth2; // success — token is valid
    } catch (e) {
      if (isInvalidGrant(e)) {
        console.error('Saved authorization has expired. Re-authenticating...');
        // Fall through to browser flow
      } else {
        throw e;
      }
    }
  }

  // 3. No valid token — launch interactive browser flow
  return await browserAuthFlow(oauth2, tokenPath);
}

async function browserAuthFlow(oauth2: OAuth2Client, tokenPath: string): Promise<OAuth2Client> {
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // ensures we always get a refresh token
  });

  // stderr — visible in terminal AND in MCP server logs (stdout is reserved for MCP protocol)
  console.error('Authentication required. Opening browser for Google sign-in...');
  console.error(`If browser doesn't open, visit:\n${authUrl}`);

  await open(authUrl); // opens default browser cross-platform

  // Temporary localhost server catches the OAuth redirect
  const code = await waitForRedirect(REDIRECT_PORT);

  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  console.error('Authentication successful. Token saved.');

  return oauth2;
}
```

### Three Auth States, One Function

| State                              | What Happens                                                                | User Experience                |
| ---------------------------------- | --------------------------------------------------------------------------- | ------------------------------ |
| No `token.json`                    | Browser opens to Google consent page, token saved on success                | ~15 seconds, first use only    |
| Token expired, refresh token valid | `google-auth-library` refreshes silently                                    | Invisible, ~100ms              |
| Refresh token revoked/expired      | Browser opens again (same as first use)                                     | ~15 seconds, rare              |
| No `credentials.json`              | Browser opens to Google Cloud Console; error with step-by-step instructions | One-time manual setup (~5 min) |

### Auth Behavior by Mode

| Mode                        | How Paths Are Provided                                                  | Browser Flow Works?                             | Status Messages Visible Via               |
| --------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| **Library**                 | Constructor args: `GmailToolkit.create({ credentialsPath, tokenPath })` | Yes — same process, opens browser directly      | `console.error` in terminal               |
| **MCP Server**              | Environment variables: `GMAIL_CREDENTIALS_PATH`, `GMAIL_TOKEN_PATH`     | Yes — `open` package works from child processes | `stderr` → Claude Desktop MCP server logs |
| **Setup script** (optional) | CLI args or defaults                                                    | Yes — designed for it                           | `console.error` in terminal               |

### Optional Pre-Auth Script

The `scripts/setup-auth.ts` script still exists as a convenience — useful for verifying credentials work before configuring Claude Desktop, or for CI/headless environments where you want to pre-authenticate on a machine with a browser. But it is **not required**. If you skip it, auth happens seamlessly on first use.

```typescript
// scripts/setup-auth.ts — optional: npx tsx scripts/setup-auth.ts
import { ensureAuthenticated } from '../src/auth.js';
await ensureAuthenticated('./credentials.json', './token.json');
console.log('Token saved. Gmail Toolkit is ready.');
```

---

## 5. Package Structure

```
gmail-toolkit/
├── src/
│   ├── index.ts                    # Library entry point (exports all layers)
│   ├── auth.ts                     # OAuth flow + token management
│   ├── types.ts                    # Shared Zod schemas + inferred TypeScript types
│   ├── config/
│   │   └── tools.ts                # Tool/resource/prompt enable/disable registry
│   ├── client/                     # Layer 1: Gmail API wrapper
│   │   ├── index.ts                # Exports GmailClient class
│   │   ├── base.ts                 # Auth integration, rate limiting, batch helpers
│   │   ├── messages.ts             # messages.* endpoints
│   │   ├── threads.ts              # threads.* endpoints
│   │   ├── labels.ts               # labels.* endpoints
│   │   ├── drafts.ts               # drafts.* endpoints
│   │   ├── filters.ts              # filters.* endpoints
│   │   ├── settings.ts             # settings.* + profile endpoints
│   │   └── history.ts              # history.* endpoints
│   ├── composed/                   # Layer 2: Aggregated operations
│   │   ├── index.ts                # Exports all composed operations
│   │   ├── search.ts               # gmail_search (list → batch get → resolve)
│   │   ├── readers.ts              # read_message, read_thread (get → resolve)
│   │   ├── labels.ts               # get_label_overview (list + counts)
│   │   ├── filters.ts              # get_filter_audit (list + resolve label names)
│   │   ├── drafts.ts               # get_drafts_summary (list → batch get)
│   │   ├── account.ts              # get_account_overview (profile + all settings)
│   │   ├── writers.ts              # Non-destructive writes (create label, modify, etc.)
│   │   ├── destructive.ts          # Destructive writes (trash, delete, send)
│   │   └── body-processing.ts      # Body cleanup pipeline (reply strip, HTML→text, etc.)
│   └── mcp-server.ts               # Layer 3: MCP tool/resource/prompt definitions
├── scripts/
│   └── setup-auth.ts               # Optional pre-auth convenience script
├── tests/
│   ├── client/                     # Unit tests with mocked API responses
│   ├── composed/                   # Integration tests with mocked client
│   └── mcp/                        # Schema and serialization tests
├── credentials.json                # OAuth client config (gitignored)
├── token.json                      # Stored tokens (gitignored)
├── package.json
├── tsconfig.json
└── .gitignore
```

### Dependencies (10)

| Package                     | Purpose                                                    | Layer   |
| --------------------------- | ---------------------------------------------------------- | ------- |
| `googleapis`                | Google API client (Gmail v1)                               | Layer 1 |
| `google-auth-library`       | OAuth 2.0 flow + token management                          | Layer 1 |
| `open`                      | Cross-platform browser launch for OAuth consent flow       | Auth    |
| `zod`                       | Runtime validation + type inference + MCP tool schemas     | All     |
| `@modelcontextprotocol/sdk` | MCP server framework                                       | Layer 3 |
| `html-to-text`              | HTML → clean plain text conversion                         | Layer 2 |
| `mailparser`                | RFC 2822 / MIME parsing for body and attachment extraction | Layer 2 |
| `email-reply-parser`        | Quoted reply chain detection and stripping                 | Layer 2 |
| `p-queue`                   | Concurrency-controlled rate limiting for API calls         | Layer 1 |
| `he`                        | HTML entity decoding (snippets, subjects)                  | Layer 2 |

### Dev Dependencies

| Package                           | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `typescript`                      | Compiler                                             |
| `vitest`                          | Test runner                                          |
| `tsx`                             | Dev runner (TypeScript execution without build step) |
| `eslint` + `@typescript-eslint/*` | Linting                                              |

---

## 6. Layer 1: Gmail Client

### Design

- Each resource type gets its own module (messages.ts, labels.ts, etc.)
- Methods map 1:1 to Gmail API endpoints
- Returns typed but unaggregated API responses (Zod-validated)
- Handles: auth attachment, pagination, batch HTTP requests, rate limiting via `p-queue`

### Endpoint Coverage

#### Messages (`client/messages.ts`)

| Method                                      | API Endpoint                             | Notes                                            |
| ------------------------------------------- | ---------------------------------------- | ------------------------------------------------ |
| `list(query, options)`                      | `GET /messages`                          | Returns IDs only; pagination handled internally  |
| `get(id, format, metadataHeaders?)`         | `GET /messages/{id}`                     | format: MINIMAL, METADATA, FULL, RAW             |
| `batchGet(ids, format)`                     | Batch of `GET /messages/{id}`            | Uses Google batch endpoint, max 100/batch        |
| `modify(id, addLabels, removeLabels)`       | `POST /messages/{id}/modify`             | Returns updated message                          |
| `batchModify(ids, addLabels, removeLabels)` | `POST /messages/batchModify`             | Max 1000 IDs per call                            |
| `send(raw, threadId?)`                      | `POST /messages/send`                    | Available in Layer 1; disabled by default in MCP |
| `trash(id)`                                 | `POST /messages/{id}/trash`              | Available in Layer 1; disabled by default in MCP |
| `untrash(id)`                               | `POST /messages/{id}/untrash`            | Available in Layer 1; disabled by default in MCP |
| `delete(id)`                                | `DELETE /messages/{id}`                  | Available in Layer 1; disabled by default in MCP |
| `import(raw, options)`                      | `POST /messages/import`                  | Layer 1 only                                     |
| `getAttachment(messageId, attachmentId)`    | `GET /messages/{msgId}/attachments/{id}` | Returns base64 data                              |

#### Threads (`client/threads.ts`)

| Method                                | API Endpoint                 | Notes                                            |
| ------------------------------------- | ---------------------------- | ------------------------------------------------ |
| `list(query, options)`                | `GET /threads`               | Returns IDs + snippets                           |
| `get(id, format)`                     | `GET /threads/{id}`          | Returns all messages in thread                   |
| `modify(id, addLabels, removeLabels)` | `POST /threads/{id}/modify`  | Applies to all messages in thread                |
| `trash(id)`                           | `POST /threads/{id}/trash`   | Available in Layer 1; disabled by default in MCP |
| `untrash(id)`                         | `POST /threads/{id}/untrash` | Available in Layer 1; disabled by default in MCP |
| `delete(id)`                          | `DELETE /threads/{id}`       | Available in Layer 1; disabled by default in MCP |

#### Labels (`client/labels.ts`)

| Method                   | API Endpoint          | Notes                                            |
| ------------------------ | --------------------- | ------------------------------------------------ |
| `list()`                 | `GET /labels`         | Returns all labels (may lack counts)             |
| `get(id)`                | `GET /labels/{id}`    | Returns single label WITH counts                 |
| `create(name, options?)` | `POST /labels`        | Use "/" in name for nesting                      |
| `update(id, updates)`    | `PATCH /labels/{id}`  | Partial update                                   |
| `delete(id)`             | `DELETE /labels/{id}` | Available in Layer 1; disabled by default in MCP |

#### Drafts (`client/drafts.ts`)

| Method                | API Endpoint          | Notes                                            |
| --------------------- | --------------------- | ------------------------------------------------ |
| `list(options?)`      | `GET /drafts`         | Returns IDs only                                 |
| `get(id, format?)`    | `GET /drafts/{id}`    | Returns draft with message content               |
| `create(message)`     | `POST /drafts`        | Creates draft from RFC 2822 message              |
| `update(id, message)` | `PUT /drafts/{id}`    | Replaces draft content                           |
| `send(id)`            | `POST /drafts/send`   | Available in Layer 1; disabled by default in MCP |
| `delete(id)`          | `DELETE /drafts/{id}` | Available in Layer 1; disabled by default in MCP |

#### Filters (`client/filters.ts`)

| Method                     | API Endpoint                    | Notes                                                  |
| -------------------------- | ------------------------------- | ------------------------------------------------------ |
| `list()`                   | `GET /settings/filters`         | Returns all filters                                    |
| `get(id)`                  | `GET /settings/filters/{id}`    | Single filter                                          |
| `create(criteria, action)` | `POST /settings/filters`        | No update endpoint — delete + recreate is the only way |
| `delete(id)`               | `DELETE /settings/filters/{id}` | Available in Layer 1; disabled by default in MCP       |

#### Settings (`client/settings.ts`)

| Method                      | API Endpoint                        | Notes                                   |
| --------------------------- | ----------------------------------- | --------------------------------------- |
| `getProfile()`              | `GET /profile`                      | Email, message/thread counts, historyId |
| `getVacation()`             | `GET /settings/vacation`            | Vacation responder config               |
| `updateVacation(settings)`  | `PUT /settings/vacation`            | Layer 1 only                            |
| `getAutoForwarding()`       | `GET /settings/autoForwarding`      | Forwarding config                       |
| `getImap()`                 | `GET /settings/imap`                | IMAP config                             |
| `getPop()`                  | `GET /settings/pop`                 | POP config                              |
| `listSendAs()`              | `GET /settings/sendAs`              | Send-as aliases                         |
| `listDelegates()`           | `GET /settings/delegates`           | Delegate accounts                       |
| `listForwardingAddresses()` | `GET /settings/forwardingAddresses` | Forwarding addresses                    |

#### History (`client/history.ts`)

| Method                           | API Endpoint   | Notes                                |
| -------------------------------- | -------------- | ------------------------------------ |
| `list(startHistoryId, options?)` | `GET /history` | Change records since given historyId |

### Batch Request Helper (`client/base.ts`)

```typescript
// Combines up to 100 API calls into a single HTTP request
// Same quota cost, but much lower latency
async batchExecute<T>(requests: BatchRequest[]): Promise<T[]>
```

### Rate Limiter (`client/base.ts`)

- Implemented via `p-queue` with `concurrency`, `interval`, and `intervalCap`
- Maps to Gmail's 250 quota units/second per-user limit
- Automatic backoff on 429 responses

---

## 7. Layer 2: Composed Operations

### Label Cache

Layer 2 maintains an in-memory label cache that maps label IDs to names. Populated on first use, refreshed on label mutations. Every read operation uses this cache automatically.

```typescript
class LabelCache {
  async resolve(labelIds: string[]): Promise<string[]>; // IDs → human names
  async lookup(labelName: string): Promise<string | null>; // name → ID
  invalidate(): void; // Force refresh on next use
}
```

### Body Processing Pipeline (`composed/body-processing.ts`)

All message body content passes through this pipeline before being included in any response. The pipeline uses proven libraries for the hard problems and minimal custom code for the simple ones.

```typescript
async function processBody(raw: ParsedMail): Promise<string> {
  // 1. Prefer text/plain; fall back to HTML → text via html-to-text
  //    (mailparser handles MIME tree traversal and content-type negotiation)
  let text = raw.text ?? htmlToText(raw.html);

  // 2. Extract latest reply only — strips quoted reply chains
  //    (email-reply-parser handles Gmail, Outlook, Apple Mail, Yahoo patterns)
  text = parseReply(text);

  // 3. Strip standard signatures: "-- \n" (RFC 3676) and "Sent from my..."
  //    (~10 lines custom code)
  text = trimStandardSignature(text);

  // 4. Clean up inline image placeholders
  //    ([cid:...] references and [image: ...] markers → removed or replaced with [image])
  text = text.replace(/\[cid:[^\]]+\]/g, '').replace(/\[image:[^\]]+\]/g, '[image]');

  // 5. Shorten tracking URLs
  //    (URLs >100 chars with utm_, /track/, /click/ patterns → [link: domain.com])
  //    (~20 lines custom code)
  text = shortenTrackingUrls(text);

  // 6. Decode HTML entities in text content
  //    (he library: &#39; → ', &amp; → &, etc.)
  text = he.decode(text);

  // 7. Collapse excessive whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}
```

**Total custom code in pipeline:** ~40 lines. Everything else is handled by `email-reply-parser`, `html-to-text`, `mailparser`, and `he`.

**What this strips (with examples from real inbox data):**

- 15,000 tokens of Chase HTML layout → ~50 tokens of clean text with key-value data
- 6-message quoted reply chain (Sandra/AA email) → latest reply only (~400 chars)
- Google security alert tracking URLs (200+ chars each) → `[link: accounts.google.com]`
- `[cid:ii_19d4a3d42f84cdccc1]` inline image references → removed
- `&#39;` / `&amp;` HTML entities in snippets → decoded to `'` / `&`

**What this preserves:**

- All content from the latest message (never strips the primary reply)
- Email addresses in From/To/CC headers (needed for comprehension and drafting replies)
- Financial amounts and dates (needed for financial summary use cases)
- Partial account numbers (needed to distinguish between accounts)
- Attachment metadata (filename, type, size — but never binary content)

### Read Operations

#### `search(query, maxResults?, pageToken?)` → `SearchResult`

**API calls behind the scenes:**

1. `messages.list(query)` → get IDs (max 20 by default)
2. `messages.batchGet(ids, format=METADATA, metadataHeaders=[From,To,Cc,Subject,Date])` → get metadata
3. `labelCache.resolve()` → resolve all label IDs to names
4. Compute summary from results already in memory (zero additional API calls)

**Response shape:**

```typescript
interface SearchResult {
  total_estimate: number;
  returned: number;
  next_page_token: string | null;
  messages: MessageSummary[];
  summary: {
    unread_count: number;
    senders: Record<string, number>; // { "Chase": 2, "NASM": 3 }
    labels: Record<string, number>; // { "Promotions": 8, "Updates": 5 }
  };
}

interface MessageSummary {
  id: string;
  thread_id: string;
  from: Contact;
  to: Contact[];
  cc: Contact[];
  subject: string;
  date: string; // ISO 8601
  snippet: string; // HTML entities decoded
  labels: string[]; // Resolved human-readable names
  is_unread: boolean; // Derived from UNREAD label
  is_starred: boolean; // Derived from STARRED label
  has_attachments: boolean; // Derived from payload metadata
  size_bytes: number;
}

interface Contact {
  name: string | null;
  email: string;
}
```

**Defaults:** `max_results` = 20. No detail level parameter — one response shape that includes everything useful from METADATA format without body content.

#### `readMessage(messageId, includeHtml?)` → `FullMessage`

**API calls:** `messages.get(id, format=FULL)` → body processing pipeline → `labelCache.resolve()`

**Response shape:**

```typescript
interface FullMessage {
  id: string;
  thread_id: string;
  from: Contact;
  to: Contact[];
  cc: Contact[];
  bcc: Contact[];
  subject: string;
  date: string; // ISO 8601
  labels: string[]; // Resolved names
  is_unread: boolean;
  is_starred: boolean;
  body_text: string; // Processed: latest reply, signatures stripped, HTML→text
  body_html: string | null; // Raw HTML — only if includeHtml=true
  attachments: AttachmentInfo[];
  size_bytes: number;
}

interface AttachmentInfo {
  id: string; // Attachment ID for download via Layer 1
  filename: string;
  mime_type: string;
  size_bytes: number;
}
```

**`includeHtml`** defaults to `false`. When `true`, the raw HTML body is included alongside the processed plain text. This is the only optional expansion flag in the entire read surface.

#### `readThread(threadId)` → `FullThread`

**API calls:** `threads.get(id, format=FULL)` → body processing pipeline per message → `labelCache.resolve()`

**Response shape:**

```typescript
interface FullThread {
  id: string;
  subject: string; // From first message
  participants: Contact[]; // Deduplicated across all messages
  message_count: number;
  messages: FullMessage[]; // Chronological order, each fully processed
  labels: string[]; // Union of all message labels
  has_unread: boolean;
  date_range: {
    first: string; // ISO 8601
    last: string;
  };
}
```

**Note:** Thread reads do NOT strip quoted replies in individual messages, since the entire conversation is being returned and each message's contribution matters for context. The body processing pipeline skips step 2 (reply extraction) when called from `readThread`.

#### `getLabels()` → `LabelOverview`

**API calls:** `labels.list()` → `labels.get(id)` for each **user** label (batched) → compute summary

User labels get individual `get` calls for accurate counts. System labels and categories use whatever counts `labels.list` provides (avoids ~15 unnecessary API calls).

**Response shape:**

```typescript
interface LabelOverview {
  system_labels: LabelDetail[];
  user_labels: LabelDetail[];
  categories: LabelDetail[];
  summary: {
    total_user_labels: number;
    empty_labels: string[]; // User labels with 0 messages
    most_active: string; // Highest message count among user labels
  };
}

interface LabelDetail {
  id: string;
  name: string;
  type: 'system' | 'user';
  messages_total: number;
  messages_unread: number;
  threads_total: number;
  threads_unread: number;
  color: { text: string; background: string } | null;
  visibility: string;
}
```

#### `getDrafts(maxResults?, query?)` → `DraftSummary`

**API calls:** `drafts.list()` → `drafts.batchGet(ids, format=METADATA)` → `labelCache.resolve()`

**Response shape:**

```typescript
interface DraftSummary {
  total: number;
  drafts: DraftDetail[];
}

interface DraftDetail {
  draft_id: string; // Draft ID (for create_draft / update operations)
  message_id: string; // Underlying message ID
  thread_id: string | null; // Non-null if this is a reply draft
  to: Contact[];
  cc: Contact[];
  subject: string | null;
  snippet: string; // HTML entities decoded
  date: string; // ISO 8601
  size_bytes: number;
  has_attachments: boolean;
}
```

**Default:** `max_results` = 10.

#### `getFilters()` → `FilterOverview`

**API calls:** `filters.list()` → `labelCache.resolve()` (for action label IDs)

**Response shape:**

```typescript
interface FilterOverview {
  total: number;
  filters: FilterDetail[];
}

interface FilterDetail {
  id: string;
  criteria: {
    from: string | null;
    to: string | null;
    subject: string | null;
    query: string | null;
    negated_query: string | null;
    has_attachment: boolean | null;
    size: number | null;
    size_comparison: 'smaller' | 'larger' | null;
  };
  actions: {
    add_labels: string[]; // Resolved human-readable names
    remove_labels: string[]; // Resolved human-readable names
    forward_to: string | null;
    skip_inbox: boolean; // Derived: true if "INBOX" in remove_labels
    mark_read: boolean; // Derived: true if "UNREAD" in remove_labels
  };
}
```

#### `getAccount()` → `AccountOverview`

**API calls (all 8, fired in parallel):** `getProfile()` + `getVacation()` + `getAutoForwarding()` + `listSendAs()` + `listDelegates()` + `listForwardingAddresses()` + `getImap()` + `getPop()`

**Why all 8:** These are tiny responses (~1KB total), execute in parallel in a single round trip (~200ms), and cost only 8 quota units. Splitting them into separate tools would force the LLM to guess which sub-setting it needs. The cost of always including everything is negligible.

**Response shape:**

```typescript
interface AccountOverview {
  email: string;
  messages_total: number;
  threads_total: number;
  history_id: string;
  vacation: {
    enabled: boolean;
    subject: string | null;
    start: string | null; // ISO 8601
    end: string | null;
    restrict_to_contacts: boolean;
  };
  forwarding: {
    enabled: boolean;
    email: string | null;
    disposition: string | null;
  };
  forwarding_addresses: Array<{
    email: string;
    verified: boolean;
  }>;
  send_as_aliases: Array<{
    email: string;
    display_name: string;
    is_default: boolean;
    reply_to: string | null;
  }>;
  delegates: Array<{
    email: string;
    status: string;
  }>;
  imap_enabled: boolean;
  pop_enabled: boolean;
}
```

### Write Operations

#### `createLabel(name, parentName?, color?)` → `LabelDetail`

- Resolves parent name to ID if provided (or uses "/" nesting in name)
- Invalidates label cache after creation
- Returns the created label with full details

#### `updateLabel(nameOrId, updates)` → `LabelDetail`

- Accepts label name OR ID (resolves via cache)
- Invalidates label cache after update
- Returns updated label

#### `modifyMessages(messageIds, addLabels?, removeLabels?)` → `ModifyResult`

- Accepts label names (resolves to IDs via cache)
- Uses `batchModify` for efficiency (max 1000 per call)
- Returns `{ modified: number, failed: string[] }`
- Common operations (all just label changes):
  - Archive = `removeLabels: ["Inbox"]`
  - Star = `addLabels: ["Starred"]`
  - Mark read = `removeLabels: ["Unread"]`
  - Mark unread = `addLabels: ["Unread"]`

#### `modifyThread(threadId, addLabels?, removeLabels?)` → `ModifyResult`

- Same interface as modifyMessages but at thread level
- Accepts label names, resolves to IDs

#### `createDraft(to?, cc?, bcc?, subject?, body?, contentType?, threadId?)` → `DraftDetail`

- Builds RFC 2822 message from structured input (via `mailparser`)
- `contentType`: "text/plain" (default) or "text/html"
- `threadId`: set to create a reply draft within an existing thread
- Returns draft detail with `draft_id` for reference

#### `createFilter(criteria, actions)` → `FilterDetail`

- Accepts label names in actions (resolves to IDs via cache)
- Returns filter with resolved human-readable label names
- Note: Gmail API has no filter update endpoint — to modify, delete + recreate

### Destructive Operations (`composed/destructive.ts`)

These are fully implemented in Layers 1 and 2 but disabled by default in the MCP tool registry. Enable via configuration.

| Operation                             | Method                   | Reversible?                    |
| ------------------------------------- | ------------------------ | ------------------------------ |
| `trashMessages(ids)`                  | `messages.trash` per ID  | Yes — 30-day recovery          |
| `trashThread(threadId)`               | `threads.trash`          | Yes — 30-day recovery          |
| `deleteMessages(ids)`                 | `messages.delete` per ID | No — permanent                 |
| `deleteThread(threadId)`              | `threads.delete`         | No — permanent                 |
| `deleteLabel(nameOrId)`               | `labels.delete`          | No — removes from all messages |
| `deleteFilter(id)`                    | `filters.delete`         | No                             |
| `deleteDraft(id)`                     | `drafts.delete`          | No                             |
| `sendDraft(draftId)`                  | `drafts.send`            | No — email is sent             |
| `sendMessage(to, subject, body, ...)` | `messages.send`          | No — email is sent             |

---

## 8. Layer 3: MCP Server

### Configuration-Driven Tool Registry

All tools are pre-defined with full schemas and handlers. A configuration object controls which ones the MCP server exposes. Changing what's exposed is a one-line config change — no logic modifications needed.

```typescript
// src/config/tools.ts
export const TOOL_REGISTRY = {
  // === Reads (always enabled) ===
  gmail_search: { enabled: true, category: 'read' },
  gmail_read_message: { enabled: true, category: 'read' },
  gmail_read_thread: { enabled: true, category: 'read' },
  gmail_get_labels: { enabled: true, category: 'read' },
  gmail_get_drafts: { enabled: true, category: 'read' },
  gmail_get_filters: { enabled: true, category: 'read' },
  gmail_get_account: { enabled: true, category: 'read' },

  // === Non-destructive writes (enabled by default) ===
  gmail_create_label: { enabled: true, category: 'write' },
  gmail_update_label: { enabled: true, category: 'write' },
  gmail_modify_messages: { enabled: true, category: 'write' },
  gmail_modify_thread: { enabled: true, category: 'write' },
  gmail_create_draft: { enabled: true, category: 'write' },
  gmail_create_filter: { enabled: true, category: 'write' },

  // === Destructive (disabled by default, opt-in) ===
  gmail_send_draft: { enabled: false, category: 'destructive' },
  gmail_send_message: { enabled: false, category: 'destructive' },
  gmail_trash_messages: { enabled: false, category: 'destructive' },
  gmail_trash_thread: { enabled: false, category: 'destructive' },
  gmail_delete_label: { enabled: false, category: 'destructive' },
  gmail_delete_filter: { enabled: false, category: 'destructive' },
  gmail_delete_draft: { enabled: false, category: 'destructive' },
} as const;
```

**To enable a destructive tool later:** Change `enabled: false` to `enabled: true`. One line, one file.

**Environment variable override (optional):**

```bash
# Enable specific tools for a session
GMAIL_ENABLE_TOOLS="gmail_send_draft,gmail_delete_filter" npx gmail-toolkit --mcp
```

### Tools (13 enabled by default + 7 disabled)

#### Read Tools (7)

| Tool                 | Parameters                                                                  | Returns           |
| -------------------- | --------------------------------------------------------------------------- | ----------------- |
| `gmail_search`       | `query: string`, `max_results?: number` (default 20), `page_token?: string` | `SearchResult`    |
| `gmail_read_message` | `message_id: string`, `include_html?: boolean` (default false)              | `FullMessage`     |
| `gmail_read_thread`  | `thread_id: string`                                                         | `FullThread`      |
| `gmail_get_labels`   | (none)                                                                      | `LabelOverview`   |
| `gmail_get_drafts`   | `max_results?: number` (default 10), `query?: string`                       | `DraftSummary`    |
| `gmail_get_filters`  | (none)                                                                      | `FilterOverview`  |
| `gmail_get_account`  | (none)                                                                      | `AccountOverview` |

#### Write Tools — Non-Destructive (6, enabled by default)

| Tool                    | Parameters                                                                                                                                           | Returns        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `gmail_create_label`    | `name: string`, `parent?: string`, `color?: { text: string, background: string }`                                                                    | `LabelDetail`  |
| `gmail_update_label`    | `label: string` (name or ID), `new_name?: string`, `color?: { text: string, background: string }`                                                    | `LabelDetail`  |
| `gmail_modify_messages` | `message_ids: string[]`, `add_labels?: string[]`, `remove_labels?: string[]`                                                                         | `ModifyResult` |
| `gmail_modify_thread`   | `thread_id: string`, `add_labels?: string[]`, `remove_labels?: string[]`                                                                             | `ModifyResult` |
| `gmail_create_draft`    | `body: string`, `to?: string`, `subject?: string`, `cc?: string`, `bcc?: string`, `content_type?: "text/plain" \| "text/html"`, `thread_id?: string` | `DraftDetail`  |
| `gmail_create_filter`   | `criteria: FilterCriteria`, `actions: FilterActions`                                                                                                 | `FilterDetail` |

#### Write Tools — Destructive (7, disabled by default)

| Tool                   | Parameters                                                                                                                    | Returns                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `gmail_send_draft`     | `draft_id: string`                                                                                                            | `{ message_id: string }` |
| `gmail_send_message`   | `to: string`, `subject: string`, `body: string`, `cc?: string`, `bcc?: string`, `content_type?: string`, `thread_id?: string` | `{ message_id: string }` |
| `gmail_trash_messages` | `message_ids: string[]`                                                                                                       | `ModifyResult`           |
| `gmail_trash_thread`   | `thread_id: string`                                                                                                           | `ModifyResult`           |
| `gmail_delete_label`   | `label: string` (name or ID)                                                                                                  | `{ deleted: boolean }`   |
| `gmail_delete_filter`  | `filter_id: string`                                                                                                           | `{ deleted: boolean }`   |
| `gmail_delete_draft`   | `draft_id: string`                                                                                                            | `{ deleted: boolean }`   |

### Resources (2)

| URI               | Name                  | Description                                                                                                        | Refresh                             |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `gmail://labels`  | Gmail Label Directory | All labels with IDs, names, types, and counts. Use to resolve label names and understand organizational structure. | On label mutation or manual refresh |
| `gmail://profile` | Gmail Account Profile | Account email, total message/thread counts, history ID.                                                            | On demand                           |

### Prompts (5)

| Prompt               | Arguments                                                               | Instruction Plan                                                                                  |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `inbox_triage`       | `days?: number`, `focus?: "financial" \| "personal" \| "work" \| "all"` | Search for urgent items, categorize by priority, surface emails needing action                    |
| `financial_summary`  | `days?: number`                                                         | Find statements, bills, payments, trade confirmations; extract key amounts and dates              |
| `newsletter_audit`   | `days?: number`                                                         | Identify subscription senders, frequency, and read rates; recommend unsubscribes                  |
| `reply_needed`       | `days?: number`                                                         | Find emails from real people (not automated senders) that likely need a human response            |
| `label_health_check` | (none)                                                                  | Audit label system: find empty/overlapping labels, unlabeled important mail, suggest improvements |

---

## 9. Library Interface

The toolkit exports everything needed for programmatic use in other TypeScript/Node projects.

```typescript
// Main entry point
import { GmailToolkit } from 'gmail-toolkit';

// Initialize — seamlessly handles auth:
// - If token.json exists and is valid: instant, silent
// - If token is expired: auto-refreshes silently
// - If no token or refresh token revoked: opens browser for Google consent
// - If no credentials.json: throws error with step-by-step setup instructions
const gmail = await GmailToolkit.create({
  credentialsPath: './credentials.json', // default
  tokenPath: './token.json', // default
});

// Layer 2 composed operations (recommended)
const results = await gmail.search('is:unread from:chase');
const message = await gmail.readMessage(results.messages[0].id);
const labels = await gmail.getLabels();
await gmail.modifyMessages(['id1', 'id2'], {
  addLabels: ['Finance/Banking'],
  removeLabels: ['Unread'],
});
await gmail.createFilter(
  { from: 'chase.com' },
  { addLabels: ['Finance/Banking'], skipInbox: true },
);

// Layer 1 raw client (when you need direct API access)
const raw = await gmail.client.messages.get('id', 'RAW');
await gmail.client.messages.trash('id');
await gmail.client.drafts.send('draft_id');
```

### Claude Desktop Integration

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "gmail-toolkit", "--mcp"],
      "env": {
        "GMAIL_CREDENTIALS_PATH": "/path/to/credentials.json",
        "GMAIL_TOKEN_PATH": "/path/to/token.json"
      }
    }
  }
}
```

---

## 10. Response Design Principles

### Every field must be:

1. **Unique** — no field duplicates information available in another field
2. **Resolved** — label IDs → names, epoch timestamps → ISO 8601, HTML entities → decoded text, raw email headers → parsed Contact objects
3. **Derived where useful** — `is_unread`, `is_starred`, `has_attachments`, `skip_inbox`, `mark_read` computed from underlying data
4. **Human-readable** — `{ name: "Chase", email: "no.reply@chase.com" }` not `"Chase <no.reply@chase.com>"`
5. **Clean** — plain text bodies with quoted replies stripped, signatures trimmed, tracking URLs shortened, CID references removed

### What we strip:

- Raw HTML body content (converted to plain text by default; raw HTML available via `include_html` flag)
- Quoted reply chains (latest reply extracted via `email-reply-parser`)
- Standard email signatures (`-- \n` and "Sent from my..." patterns)
- CID inline image references and `[image: ...]` placeholders
- Tracking URLs (replaced with `[link: domain.com]`)
- HTML entities in snippets and subjects (decoded via `he`)
- Excessive whitespace (collapsed to double newlines max)

### What we preserve:

- From/To/CC email addresses (required for comprehension and reply drafting)
- Financial amounts, dates, and partial account numbers (required for financial use cases)
- All content from the latest message in a thread (never truncate primary content)
- Attachment metadata: filename, type, size (never binary content)

---

## 11. Rate Limiting & Quotas

| Limit                  | Value                     |
| ---------------------- | ------------------------- |
| Per-user rate          | 250 quota units/second    |
| Daily project quota    | 1,000,000,000 units       |
| Batch HTTP request max | 100 calls per batch       |
| `batchModify` max      | 1000 message IDs per call |

### Quota Cost Estimates Per Composed Operation

| Operation                    | Estimated API Calls                               | Estimated Quota Units |
| ---------------------------- | ------------------------------------------------- | --------------------- |
| `search` (20 results)        | 1 list + 1 batch(20 gets) + 1 label list (cached) | ~106 units            |
| `readMessage`                | 1 get + 1 label list (cached)                     | ~6 units              |
| `readThread`                 | 1 get + 1 label list (cached)                     | ~6 units              |
| `getLabels` (24 user labels) | 1 list + 24 gets (user labels only)               | ~25 units             |
| `getDrafts` (10 results)     | 1 list + 1 batch(10 gets) + 1 label list (cached) | ~56 units             |
| `getFilters`                 | 1 list + 1 label list (cached)                    | ~6 units              |
| `getAccount`                 | 8 parallel settings calls                         | ~8 units              |
| `modifyMessages` (batch)     | 1 batchModify                                     | ~50 units             |
| `createLabel`                | 1 create                                          | ~5 units              |
| `createFilter`               | 1 create + 1 label list (cached)                  | ~6 units              |

---

## 12. Error Handling

| HTTP Code | Meaning               | Client Behavior                                                                                       |
| --------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| 400       | Bad request           | Return structured error with message                                                                  |
| 401       | Token expired/invalid | Auto-refresh via `google-auth-library`; if refresh fails (`invalid_grant`), trigger browser auth flow |
| 403       | Insufficient scope    | Return error identifying the required scope                                                           |
| 404       | Resource not found    | Return error with the ID that wasn't found                                                            |
| 429       | Rate limited          | Exponential backoff via `p-queue`, retry up to 3 times                                                |
| 500       | Google server error   | Retry once with backoff                                                                               |

```typescript
interface GmailToolkitError {
  code: number;
  message: string;
  operation: string; // Which composed operation failed
  retryable: boolean;
}
```

---

## 13. Testing Strategy

| Layer   | Test Type                          | What's Tested                                                                            |
| ------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| Layer 1 | Unit tests (mocked HTTP)           | API call construction, pagination logic, batch assembly, rate limiter behavior           |
| Layer 2 | Integration tests (mocked Layer 1) | Aggregation logic, label resolution, body processing pipeline, summary computation       |
| Layer 2 | Body processing tests              | Reply stripping, signature trimming, HTML→text, tracking URL shortening, entity decoding |
| Layer 3 | Schema tests                       | Zod schemas match expected response shapes, tool registry config validation              |
| E2E     | Manual against real account        | Full flow: auth → search → read → modify → verify                                        |
