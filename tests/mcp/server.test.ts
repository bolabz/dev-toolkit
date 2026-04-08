/**
 * Layer 3 — MCP Server Tests
 *
 * Tests tool registry configuration, schema generation, and serialization.
 */

import { describe, it, expect } from 'vitest';

describe('MCP Server', () => {
  describe('Tool Registry', () => {
    it.todo('resolveToolRegistry() returns all 20 tools');
    it.todo('default config enables exactly 13 tools');
    it.todo('GMAIL_ENABLE_TOOLS env var enables specific tools');
    it.todo('GMAIL_DISABLE_TOOLS env var disables specific tools');
    it.todo('GMAIL_DISABLE_TOOLS takes precedence over GMAIL_ENABLE_TOOLS');
    it.todo('getEnabledTools() filters to only enabled tools');
    it.todo('getToolsByCategory() groups correctly');
  });

  describe('Response Serialization', () => {
    it.todo('tool responses are valid JSON');
    it.todo('resource responses include correct URI and mimeType');
  });
});
