/**
 * Layer 1 — Messages Client Tests
 *
 * Tests API call construction, pagination, and batch assembly
 * with mocked HTTP responses.
 */

import { describe, it } from 'vitest';

describe('MessagesClient', () => {
  it.todo('list() returns parsed message IDs and pagination token');
  it.todo('list() handles empty results');
  it.todo('get() requests correct format and metadataHeaders');
  it.todo('batchGet() executes concurrent requests through rate limiter');
  it.todo('batchModify() chunks IDs at 1000 per call');
  it.todo('modify() sends correct addLabelIds and removeLabelIds');
  it.todo('send() base64url-encodes the raw message');
  it.todo('trash() and untrash() call correct endpoints');
  it.todo('getAttachment() returns decoded data');
});
