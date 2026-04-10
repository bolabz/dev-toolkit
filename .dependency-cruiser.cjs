/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  extends: 'dependency-cruiser/configs/recommended-strict',
  forbidden: [
    // --- Layer boundary enforcement ---
    // Architecture: Layer 1 (client/) ← Layer 2 (composed/) ← Layer 3 (mcp-server/)
    // Cross-cutting modules (auth, errors, logger, types) are accessible from any layer.
    {
      name: 'layer-1-cannot-import-layer-2',
      severity: 'error',
      comment: 'Client (Layer 1) must not depend on composed operations (Layer 2).',
      from: { path: '^src/client/' },
      to: { path: '^src/composed/' },
    },
    {
      name: 'layer-1-cannot-import-layer-3',
      severity: 'error',
      comment: 'Client (Layer 1) must not depend on MCP server (Layer 3).',
      from: { path: '^src/client/' },
      to: { path: '^src/mcp-server' },
    },
    {
      name: 'layer-2-cannot-import-layer-3',
      severity: 'error',
      comment: 'Composed operations (Layer 2) must not depend on MCP server (Layer 3).',
      from: { path: '^src/composed/' },
      to: { path: '^src/mcp-server' },
    },
    {
      name: 'layer-3-cannot-import-layer-1',
      severity: 'error',
      comment:
          'MCP server (Layer 3) must use GmailContext from Layer 2, not import Layer 1 directly.',
      from: { path: '^src/mcp-server' },
      to: { path: '^src/client/' },
    },
    {
      name: 'public-api-cannot-import-layer-1',
      severity: 'error',
      comment: 'Public API must depend on Layer 2 (composed), not Layer 1 (client) directly.',
      from: { path: '^src/index\\.ts$' },
      to: { path: '^src/client/' },
    },
  ],
  options: {
    includeOnly: '^src/',
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    cache: false,
    reporterOptions: {
      archi: {
        collapsePattern: [
          '^src/client/[^/]+',
          '^src/composed/[^/]+',
          '^src/mcp-server/[^/]+',
          'node_modules/(@[^/]+/[^/]+|[^/]+)',
        ],
      },
      dot: {
        showMetrics: true,
      },
    },
  },
};