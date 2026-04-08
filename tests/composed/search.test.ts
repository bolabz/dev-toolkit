/**
 * Layer 2 — Search Composed Operation Tests
 *
 * Tests aggregation logic, label resolution, and summary computation
 * with mocked Layer 1 client.
 */

import { describe, it, expect } from 'vitest';

describe('search()', () => {
  it.todo('aggregates list → batchGet → label resolve into SearchResult');
  it.todo('computes correct unread_count in summary');
  it.todo('computes correct sender frequency counts');
  it.todo('computes correct label distribution counts');
  it.todo('handles empty search results');
  it.todo('passes page_token through correctly');
  it.todo('decodes HTML entities in snippets');
  it.todo('parses complex From headers into Contact objects');
});
