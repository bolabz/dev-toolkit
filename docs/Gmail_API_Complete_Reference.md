# Gmail API v1 — Complete Endpoint & Schema Reference

**Purpose:** Map every Gmail API endpoint, its request/response shape, and quota cost to inform the design of aggregated MCP read tools and granular write tools.

---

## Table of Contents

1. [Authentication & Quotas](#1-authentication--quotas)
2. [Messages Resource](#2-messages-resource)
3. [Threads Resource](#3-threads-resource)
4. [Labels Resource](#4-labels-resource)
5. [Drafts Resource](#5-drafts-resource)
6. [History Resource](#6-history-resource)
7. [Settings Resource](#7-settings-resource)
8. [Filters Resource](#8-filters-resource)
9. [Forwarding Addresses Resource](#9-forwarding-addresses-resource)
10. [Delegates Resource](#10-delegates-resource)
11. [Send As Resource](#11-send-as-resource)
12. [Profile Resource](#12-profile-resource)
13. [Batch Requests](#13-batch-requests)
14. [Field Masks (Partial Responses)](#14-field-masks-partial-responses)
15. [Aggregation Analysis](#15-aggregation-analysis)

---

## 1. Authentication & Quotas

### OAuth 2.0 Scopes

| Scope | Access Level |
|-------|-------------|
| `gmail.readonly` | Read-only: messages, threads, labels, settings, drafts |
| `gmail.modify` | Read + write: messages, threads, labels (not settings, not send) |
| `gmail.labels` | Labels only: create, update, delete |
| `gmail.send` | Send messages only |
| `gmail.compose` | Create/modify/send drafts |
| `gmail.settings.basic` | Manage filters, forwarding, IMAP/POP, vacation |
| `gmail.settings.sharing` | Manage delegates |
| `mail.google.com` | Full unrestricted access |

**Recommended for full MCP server:** `gmail.modify` + `gmail.settings.basic` + `gmail.compose`

This covers everything except delegate management (`gmail.settings.sharing`) which is rarely needed for personal use.

### Rate Limits

| Limit Type | Value |
|-----------|-------|
| Per-project daily quota | 1,000,000,000 quota units |
| Per-user rate limit | 250 quota units/second (allows bursts) |

### Quota Units by Operation Type

| Operation | Approximate Cost |
|----------|-----------------|
| `labels.list`, `labels.get` | 1 unit |
| `messages.list`, `threads.list` | 5 units |
| `messages.get` (minimal) | 5 units |
| `messages.get` (full/metadata) | 5 units |
| `messages.modify`, `threads.modify` | 5 units |
| `messages.batchModify` | 50 units |
| `drafts.create`, `drafts.update` | 10 units |
| `messages.send`, `drafts.send` | 100 units |
| `filters.create`, `filters.delete` | 5 units |

---

## 2. Messages Resource

**Base path:** `GET/POST/DELETE /gmail/v1/users/{userId}/messages`

### 2a. messages.list

**Method:** `GET /users/{userId}/messages`

**Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | path string | Yes | Email address or "me" |
| `q` | query string | No | Gmail search query syntax |
| `labelIds` | query string[] | No | Filter by label IDs (repeated param) |
| `maxResults` | query integer | No | Default 100, max 500 |
| `pageToken` | query string | No | Pagination token |
| `includeSpamTrash` | query boolean | No | Default false |

**Response:**

```json
{
  "messages": [
    {
      "id": "string",        // message ID only
      "threadId": "string"   // thread ID only
    }
  ],
  "nextPageToken": "string",
  "resultSizeEstimate": integer
}
```

**KEY INSIGHT:** `messages.list` returns ONLY IDs. No subject, no sender, no snippet, nothing. To get any useful information, you must call `messages.get` on each ID. This is the single biggest reason for aggregated reads.

### 2b. messages.get

**Method:** `GET /users/{userId}/messages/{id}`

**Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | path string | Yes | Email address or "me" |
| `id` | path string | Yes | Message ID |
| `format` | query string | No | Response detail level (see below) |
| `metadataHeaders` | query string[] | No | Headers to include when format=METADATA |

**Format Options (critical for aggregation design):**

| Format | Returns | Excludes | Use Case |
|--------|---------|----------|----------|
| `MINIMAL` | id, threadId, labelIds, snippet, historyId, internalDate, sizeEstimate | All headers, body, payload | Bulk label/status checks |
| `METADATA` | Everything in MINIMAL + payload.headers (filtered by metadataHeaders param) | Body content, attachments | Inbox summaries, triage |
| `FULL` (default) | Complete parsed message: all headers, body parts, attachment metadata | Raw RFC 2822 string | Reading a specific email |
| `RAW` | id, threadId, labelIds, snippet, historyId, internalDate, sizeEstimate, raw (base64url RFC 2822) | Parsed payload | Forwarding, export, re-import |

**Full Response Schema (format=FULL):**

```json
{
  "id": "string",
  "threadId": "string",
  "labelIds": ["string"],
  "snippet": "string",
  "historyId": "string",
  "internalDate": "string (millis since epoch)",
  "sizeEstimate": integer,
  "payload": {
    "partId": "string",
    "mimeType": "string",
    "filename": "string",
    "headers": [
      { "name": "string", "value": "string" }
    ],
    "body": {
      "size": integer,
      "data": "string (base64url)",
      "attachmentId": "string"
    },
    "parts": [
      // Recursive MessagePart objects
      // multipart/alternative → text/plain + text/html
      // multipart/mixed → body parts + attachments
    ]
  }
}
```

**MessagePart recursive structure:**
- `multipart/mixed` → contains body + attachments as `parts[]`
- `multipart/alternative` → contains text/plain + text/html as `parts[]`
- `text/plain` or `text/html` → leaf node with `body.data`
- Attachment → leaf node with `body.attachmentId` + `filename`

### 2c. messages.send

**Method:** `POST /users/{userId}/messages/send`

**Request body:**

```json
{
  "raw": "string (base64url encoded RFC 2822 message)",
  "threadId": "string (optional, to send as reply in thread)"
}
```

**Response:** Full Message object of the sent message.

### 2d. messages.modify

**Method:** `POST /users/{userId}/messages/{id}/modify`

**Request body:**

```json
{
  "addLabelIds": ["string"],
  "removeLabelIds": ["string"]
}
```

**Response:** Full Message object (minimal format — id, threadId, labelIds).

**Common label operations (all done via modify):**
- Archive = removeLabelIds: ["INBOX"]
- Star = addLabelIds: ["STARRED"]
- Mark read = removeLabelIds: ["UNREAD"]
- Mark unread = addLabelIds: ["UNREAD"]
- Mark important = addLabelIds: ["IMPORTANT"]
- Move to spam = addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"]

### 2e. messages.batchModify

**Method:** `POST /users/{userId}/messages/batchModify`

**Request body:**

```json
{
  "ids": ["string"],          // max 1000 message IDs per call
  "addLabelIds": ["string"],
  "removeLabelIds": ["string"]
}
```

**Response:** Empty body on success (HTTP 204).

**Limit:** 1000 message IDs per request.

### 2f. messages.trash / messages.untrash

**Method:** `POST /users/{userId}/messages/{id}/trash`
**Method:** `POST /users/{userId}/messages/{id}/untrash`

**Request body:** Empty.
**Response:** Message object.

### 2g. messages.delete

**Method:** `DELETE /users/{userId}/messages/{id}`

**PERMANENTLY** deletes a message. Cannot be undone. Does not go to Trash.
**Response:** Empty body on success.

### 2h. messages.import

**Method:** `POST /users/{userId}/messages/import`

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `internalDateSource` | query string | "receivedTime" or "dateHeader" |
| `neverMarkSpam` | query boolean | Don't classify as spam |
| `processForCalendar` | query boolean | Process calendar attachments |
| `deleted` | query boolean | Mark as TRASH immediately |

**Request body:** Raw RFC 2822 message (base64url encoded).
**Response:** Message object.

### 2i. messages.insert

**Method:** `POST /users/{userId}/messages`

Similar to import but bypasses most scanning. Inserts directly into mailbox.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `internalDateSource` | query string | "receivedTime" or "dateHeader" |
| `deleted` | query boolean | Mark as TRASH |

**Request body:** Raw RFC 2822 message.
**Response:** Message object.

### 2j. messages.attachments.get

**Method:** `GET /users/{userId}/messages/{messageId}/attachments/{id}`

**Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | path string | Yes | Email or "me" |
| `messageId` | path string | Yes | Parent message ID |
| `id` | path string | Yes | Attachment ID (from MessagePartBody.attachmentId) |

**Response:**

```json
{
  "size": integer,
  "data": "string (base64url encoded attachment data)"
}
```

---

## 3. Threads Resource

**Base path:** `GET/POST/DELETE /gmail/v1/users/{userId}/threads`

### 3a. threads.list

**Method:** `GET /users/{userId}/threads`

**Parameters:** Same as messages.list (q, labelIds, maxResults, pageToken, includeSpamTrash).

**Response:**

```json
{
  "threads": [
    {
      "id": "string",
      "snippet": "string",
      "historyId": "string"
    }
  ],
  "nextPageToken": "string",
  "resultSizeEstimate": integer
}
```

**KEY INSIGHT:** Unlike messages.list, threads.list returns a snippet. But still no subjects, participants, or message details. Still requires threads.get for useful data.

### 3b. threads.get

**Method:** `GET /users/{userId}/threads/{id}`

**Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | path string | Yes | Email or "me" |
| `id` | path string | Yes | Thread ID |
| `format` | query string | No | FULL, METADATA, MINIMAL (same as messages) |
| `metadataHeaders` | query string[] | No | Headers for METADATA format |

**Response:**

```json
{
  "id": "string",
  "historyId": "string",
  "messages": [
    // Array of full Message objects (format applies to each)
  ]
}
```

**KEY INSIGHT:** threads.get returns ALL messages in the thread in one call, each formatted per the `format` parameter. This is already somewhat aggregated — one call gets an entire conversation.

### 3c. threads.modify

**Method:** `POST /users/{userId}/threads/{id}/modify`

**Request body:** Same as messages.modify — `addLabelIds`, `removeLabelIds`.
**Response:** Thread object.
**Effect:** Applies label changes to ALL messages in the thread.

### 3d. threads.trash / threads.untrash / threads.delete

Same pattern as messages — trash is reversible, delete is permanent.

---

## 4. Labels Resource

**Base path:** `GET/POST/PUT/PATCH/DELETE /gmail/v1/users/{userId}/labels`

### 4a. labels.list

**Method:** `GET /users/{userId}/labels`

**Parameters:** Just `userId`.

**Response:**

```json
{
  "labels": [
    {
      "id": "string",
      "name": "string",
      "type": "system" | "user",
      "messageListVisibility": "show" | "hide",
      "labelListVisibility": "labelShow" | "labelHide" | "labelShowIfUnread",
      "messagesTotal": integer,
      "messagesUnread": integer,
      "threadsTotal": integer,
      "threadsUnread": integer,
      "color": {
        "textColor": "string",
        "backgroundColor": "string"
      }
    }
  ]
}
```

**KEY INSIGHT:** labels.list returns message/thread counts per label. This is free metadata — no need to separately count messages per label.

**CAVEAT:** The count fields (messagesTotal, messagesUnread, etc.) are only returned for labels.get on a specific label. labels.list may return them but the behavior is not guaranteed for all labels. Some implementations require calling labels.get individually to get counts.

### 4b. labels.get

**Method:** `GET /users/{userId}/labels/{id}`

**Response:** Single Label object with all fields including counts.

### 4c. labels.create

**Method:** `POST /users/{userId}/labels`

**Request body:**

```json
{
  "name": "string",                    // required; use "/" for nesting: "Finance/Banking"
  "labelListVisibility": "string",     // optional
  "messageListVisibility": "string",   // optional
  "color": {                           // optional
    "textColor": "string",
    "backgroundColor": "string"
  }
}
```

**Response:** The created Label object with server-assigned `id`.

**Nesting:** Gmail supports nested labels via the "/" character in the name. Creating "Finance/Banking" automatically nests it under "Finance" (and creates the parent if it doesn't exist).

### 4d. labels.update (PUT) / labels.patch (PATCH)

**Method:** `PUT /users/{userId}/labels/{id}` (full replace)
**Method:** `PATCH /users/{userId}/labels/{id}` (partial update)

**Request body:** Label object with fields to update.
**Response:** Updated Label object.

### 4e. labels.delete

**Method:** `DELETE /users/{userId}/labels/{id}`

**Response:** Empty body.
**Effect:** Removes the label from all messages and threads. Does not delete messages.

---

## 5. Drafts Resource

**Base path:** `GET/POST/PUT/DELETE /gmail/v1/users/{userId}/drafts`

### 5a. drafts.list

**Method:** `GET /users/{userId}/drafts`

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `maxResults` | query integer | Default 100, max 500 |
| `pageToken` | query string | Pagination |
| `q` | query string | Search query (searches draft content) |
| `includeSpamTrash` | query boolean | Default false |

**Response:**

```json
{
  "drafts": [
    {
      "id": "string",
      "message": {
        "id": "string",
        "threadId": "string"
      }
    }
  ],
  "nextPageToken": "string",
  "resultSizeEstimate": integer
}
```

**KEY INSIGHT:** Like messages.list, drafts.list returns only IDs. Need drafts.get for content.

### 5b. drafts.get

**Method:** `GET /users/{userId}/drafts/{id}`

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `format` | query string | FULL, METADATA, MINIMAL, RAW |

**Response:**

```json
{
  "id": "string",
  "message": {
    // Full Message object (same schema as messages.get)
  }
}
```

### 5c. drafts.create

**Method:** `POST /users/{userId}/drafts`

**Request body:**

```json
{
  "message": {
    "raw": "string (base64url encoded RFC 2822)",
    "threadId": "string (optional, for reply drafts)"
  }
}
```

**Response:** Draft object with assigned `id`.

### 5d. drafts.update

**Method:** `PUT /users/{userId}/drafts/{id}`

**Request body:** Same as create — replaces the draft content entirely.
**Response:** Updated Draft object.

### 5e. drafts.delete

**Method:** `DELETE /users/{userId}/drafts/{id}`

**Response:** Empty body.

### 5f. drafts.send

**Method:** `POST /users/{userId}/drafts/send`

**Request body:**

```json
{
  "id": "string"   // draft ID to send
}
```

**Response:** Message object of the sent message.

---

## 6. History Resource

**Base path:** `GET /gmail/v1/users/{userId}/history`

### 6a. history.list

**Method:** `GET /users/{userId}/history`

**Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `startHistoryId` | query string | Yes | Return records after this ID |
| `labelId` | query string | No | Filter to this label |
| `maxResults` | query integer | No | Default 100 |
| `pageToken` | query string | No | Pagination |
| `historyTypes` | query string[] | No | Filter: "messageAdded", "messageDeleted", "labelAdded", "labelRemoved" |

**Response:**

```json
{
  "history": [
    {
      "id": "string",
      "messages": [
        { "id": "string", "threadId": "string" }
      ],
      "messagesAdded": [
        {
          "message": { "id": "string", "threadId": "string", "labelIds": ["string"] }
        }
      ],
      "messagesDeleted": [
        {
          "message": { "id": "string", "threadId": "string", "labelIds": ["string"] }
        }
      ],
      "labelsAdded": [
        {
          "message": { "id": "string", "threadId": "string", "labelIds": ["string"] },
          "labelIds": ["string"]
        }
      ],
      "labelsRemoved": [
        {
          "message": { "id": "string", "threadId": "string", "labelIds": ["string"] },
          "labelIds": ["string"]
        }
      ]
    }
  ],
  "nextPageToken": "string",
  "historyId": "string"
}
```

**KEY INSIGHT:** History is the only way to get "what changed since last time I checked" without re-scanning the entire inbox. Essential for incremental sync / scheduled tasks.

---

## 7. Settings Resource

**Base path:** `GET/PUT /gmail/v1/users/{userId}/settings`

### 7a. settings.getAutoForwarding / updateAutoForwarding

**Response/Request:**

```json
{
  "enabled": boolean,
  "emailAddress": "string",
  "disposition": "leaveInInbox" | "archive" | "trash" | "markRead"
}
```

### 7b. settings.getImap / updateImap

**Response/Request:**

```json
{
  "enabled": boolean,
  "autoExpunge": boolean,
  "expungeBehavior": "archive" | "trash" | "deleteForever",
  "maxFolderSize": integer
}
```

### 7c. settings.getPop / updatePop

**Response/Request:**

```json
{
  "accessWindow": "disabled" | "allMail" | "fromNowOn",
  "disposition": "leaveInInbox" | "archive" | "trash" | "markRead"
}
```

### 7d. settings.getVacation / updateVacation

**Response/Request:**

```json
{
  "enableAutoReply": boolean,
  "responseSubject": "string",
  "responseBodyPlainText": "string",
  "responseBodyHtml": "string",
  "restrictToContacts": boolean,
  "restrictToDomain": boolean,
  "startTime": "string (epoch millis)",
  "endTime": "string (epoch millis)"
}
```

### 7e. settings.getLanguage / updateLanguage

**Response/Request:**

```json
{
  "displayLanguage": "string (BCP 47 tag)"
}
```

---

## 8. Filters Resource

**Base path:** `GET/POST/DELETE /gmail/v1/users/{userId}/settings/filters`

### 8a. filters.list

**Method:** `GET /users/{userId}/settings/filters`

**Response:**

```json
{
  "filter": [
    {
      "id": "string",
      "criteria": {
        "from": "string",
        "to": "string",
        "subject": "string",
        "query": "string",
        "negatedQuery": "string",
        "hasAttachment": boolean,
        "excludeChats": boolean,
        "size": integer,
        "sizeComparison": "smaller" | "larger"
      },
      "action": {
        "addLabelIds": ["string"],
        "removeLabelIds": ["string"],
        "forward": "string",
        "sizeComparison": "string"
      }
    }
  ]
}
```

**Note:** Filter actions reference label IDs, not names. An aggregated read should resolve these.

### 8b. filters.get

**Method:** `GET /users/{userId}/settings/filters/{id}`

**Response:** Single Filter object (same schema as above).

### 8c. filters.create

**Method:** `POST /users/{userId}/settings/filters`

**Request body:**

```json
{
  "criteria": {
    "from": "string",
    "to": "string",
    "subject": "string",
    "query": "string",
    "negatedQuery": "string",
    "hasAttachment": boolean,
    "excludeChats": boolean,
    "size": integer,
    "sizeComparison": "smaller" | "larger"
  },
  "action": {
    "addLabelIds": ["string"],
    "removeLabelIds": ["string"],
    "forward": "string"
  }
}
```

**Response:** Created Filter object with assigned `id`.

**KEY INSIGHT:** You cannot update a filter. To modify one, you must delete it and create a new one.

### 8d. filters.delete

**Method:** `DELETE /users/{userId}/settings/filters/{id}`

**Response:** Empty body.

---

## 9. Forwarding Addresses Resource

**Base path:** `GET/POST/DELETE /gmail/v1/users/{userId}/settings/forwardingAddresses`

### Schema

```json
{
  "forwardingEmail": "string",
  "verificationStatus": "accepted" | "pending" | "verificationStatusUnspecified"
}
```

**Methods:** list, get, create, delete.

**Note:** Creating a forwarding address sends a verification email. The address cannot be used until verified.

---

## 10. Delegates Resource

**Base path:** `GET/POST/DELETE /gmail/v1/users/{userId}/settings/delegates`

### Schema

```json
{
  "delegateEmail": "string",
  "verificationStatus": "accepted" | "pending" | "rejected" | "expired"
}
```

**Methods:** list, get, create, delete.

**Note:** Requires `gmail.settings.sharing` scope (separate from `gmail.settings.basic`).

---

## 11. Send As Resource

**Base path:** `GET/POST/PUT/PATCH/DELETE /gmail/v1/users/{userId}/settings/sendAs`

### Schema

```json
{
  "sendAsEmail": "string",
  "displayName": "string",
  "replyToAddress": "string",
  "signature": "string",
  "isPrimary": boolean,
  "isDefault": boolean,
  "treatAsAlias": boolean,
  "verificationStatus": "accepted" | "pending",
  "smimeInfo": {
    "id": "string",
    "issuerCn": "string",
    "isDefault": boolean,
    "expiration": "string (epoch millis)",
    "sha1Fingerprint": "string",
    "pem": "string",
    "pkcs12": "string (base64url)"
  }
}
```

**Methods:** list, get, create, update, patch, delete, verify.

**Sub-resource:** `sendAs.smimeInfo` — list, get, insert, delete, setDefault for S/MIME certificates.

---

## 12. Profile Resource

**Method:** `GET /users/{userId}/profile`

**Response:**

```json
{
  "emailAddress": "string",
  "messagesTotal": integer,
  "threadsTotal": integer,
  "historyId": "string"
}
```

---

## 13. Batch Requests

Gmail supports Google's standard batch endpoint for combining multiple API calls into one HTTP request.

| Property | Value |
|----------|-------|
| Max calls per batch | 100 |
| Quota savings | NONE — each inner call costs its normal quota |
| Benefit | Reduces HTTP connection overhead (latency savings) |
| Format | multipart/mixed with individual HTTP request parts |
| Constraint | All inner requests must target the same API |

**Use case for MCP server:** When an aggregated read needs to call `messages.get` on 25 messages, batch them into a single HTTP request instead of 25 separate connections. Same quota cost, much lower latency.

---

## 14. Field Masks (Partial Responses)

The `fields` parameter reduces response size by requesting only specific fields.

**Syntax:**

| Pattern | Example | Meaning |
|---------|---------|---------|
| Top-level | `fields=id,snippet` | Only return id and snippet |
| Nested | `fields=payload/headers` | Only return headers from payload |
| Sub-select | `fields=messages(id,snippet)` | For array items, only return id and snippet |
| Deep nested | `fields=payload/headers,payload/parts(mimeType,filename)` | Combine nested selections |

**Use case for MCP server:** When fetching messages for a summary, request only the fields you'll include in the aggregated response. Cuts bandwidth and parse time significantly.

---

## 15. Aggregation Analysis

### The Core Problem

The Gmail API is designed around resource-level CRUD, not task-level operations. Every useful "view" of the inbox requires multiple API calls:

| User Intent | API Calls Required |
|------------|-------------------|
| "Show me my inbox" | messages.list (IDs only) → N × messages.get → labels.list (resolve names) |
| "What labels do I have and how full are they?" | labels.list → N × labels.get (for counts) |
| "Show me this conversation" | threads.get (one call, but returns raw label IDs) → labels.list (resolve) |
| "What filters do I have?" | filters.list (returns label IDs in actions) → labels.list (resolve) |
| "What changed since yesterday?" | history.list → messages.get for each changed message → labels.list |

### Natural Aggregation Boundaries

Based on the API shapes above, here are the natural read-aggregation boundaries:

**Boundary 1: Message List + Detail + Label Resolution**
- `messages.list` returns only IDs
- `messages.get` with format=METADATA returns headers + labels cheaply
- `labels.list` is needed to resolve label IDs → names
- These three ALWAYS go together for any inbox view
- Batch `messages.get` calls to minimize latency
- Use `fields` parameter to reduce payload size

**Boundary 2: Thread + Full Content + Label Resolution**
- `threads.get` already returns all messages — this is semi-aggregated
- But label IDs still need resolution via `labels.list`
- Attachment metadata is in the response but actual content needs `attachments.get`

**Boundary 3: Labels + Counts**
- `labels.list` returns names and types
- Individual `labels.get` returns counts (messages, unread, threads)
- These should be combined into one view

**Boundary 4: Settings + Filters + Labels**
- `filters.list` returns label IDs in actions
- `labels.list` needed to resolve filter action label names
- All settings endpoints (autoforwarding, imap, pop, vacation, sendAs, delegates, forwarding) are small, independent, cheap calls
- Could be combined into a single "account settings overview"

**Boundary 5: History + Message Details + Labels**
- `history.list` returns change records with message IDs
- Enriching these with `messages.get` (at least METADATA format) makes them useful
- `labels.list` for resolution

### What This Means for `format` Parameter Strategy

| Aggregated Read Purpose | Best `format` | Why |
|------------------------|---------------|-----|
| Inbox summary / triage | METADATA + metadataHeaders=[From, To, Subject, Date] | Headers + labels without body = fast + cheap |
| Read specific email | FULL | Need body content |
| Bulk categorization | MINIMAL | Only need labels + IDs for batch operations |
| Export / backup | RAW | Complete RFC 2822 for archival |

### Endpoints That Don't Need Aggregation (Already Complete)

| Endpoint | Why It Stands Alone |
|----------|-------------------|
| `messages.get` (format=FULL, single message) | Already returns everything for one email |
| `threads.get` (format=FULL) | Already returns full conversation |
| `profile.getProfile` | Tiny, complete response |
| Individual settings (vacation, IMAP, etc.) | Small, self-contained |
