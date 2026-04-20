/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  extends: 'dependency-cruiser/configs/recommended-strict',
  forbidden: [
    // --- Layer boundary enforcement ---
    // Architecture: Layer 1 (client/) ← Layer 2 (api/) ← Layer 3 (mcp/)
    // Cross-cutting modules (infra/auth, infra/errors, infra/logger, infra/types) are accessible from any layer.
    {
      name: 'layer-1-cannot-import-layer-2',
      severity: 'error',
      comment: 'Client (Layer 1) must not depend on api operations (Layer 2).',
      from: { path: '^src/client/' },
      to: { path: '^src/api/' },
    },
    {
      name: 'layer-1-cannot-import-layer-3',
      severity: 'error',
      comment: 'Client (Layer 1) must not depend on MCP server (Layer 3).',
      from: { path: '^src/client/' },
      to: { path: '^src/mcp' },
    },
    {
      name: 'layer-2-cannot-import-layer-3',
      severity: 'error',
      comment: 'Composed operations (Layer 2) must not depend on MCP server (Layer 3).',
      from: { path: '^src/api/' },
      to: { path: '^src/mcp' },
    },
    {
      name: 'layer-3-cannot-import-layer-1',
      severity: 'error',
      comment:
        'MCP server (Layer 3) must use GmailContext from Layer 2, not import Layer 1 directly.',
      from: { path: '^src/mcp' },
      to: { path: '^src/client/' },
    },
    {
      name: 'public-api-cannot-import-layer-1',
      severity: 'error',
      comment: 'Public API must depend on Layer 2 (api), not Layer 1 (client) directly.',
      from: { path: '^src/index\\.ts$' },
      to: { path: '^src/client/' },
    },
    {
      name: 'public-api-cannot-import-layer-3',
      severity: 'error',
      comment: 'Public API must not depend on MCP server (Layer 3).',
      from: { path: '^src/index\\.ts$' },
      to: { path: '^src/mcp' },
    },
    // --- Barrel-only cross-layer imports ---
    // External consumers of a layer must go through the layer's index.ts (public API).
    // Prevents deep imports that bypass the encapsulation boundary.
    {
      name: 'no-deep-imports-into-client',
      severity: 'error',
      comment: 'External consumers must use client/index.ts, not reach into internal modules.',
      from: { pathNot: '^src/client/' },
      to: { path: '^src/client/', pathNot: '^src/client/index\\.ts$' },
    },
    {
      name: 'no-deep-imports-into-api',
      severity: 'error',
      comment: 'External consumers must use api/index.ts, not reach into internal modules.',
      from: { pathNot: '^src/api/' },
      to: { path: '^src/api/', pathNot: '^src/api/index\\.ts$' },
    },
    {
      name: 'no-deep-imports-into-infra',
      severity: 'error',
      comment: 'External consumers must use infra/index.ts, not reach into internal modules.',
      from: { pathNot: '^src/infra/' },
      to: { path: '^src/infra/', pathNot: '^src/infra/index\\.ts$' },
    },
    // --- Single point of contact: only context.ts bridges L2 → L1 ---
    // All other api modules receive L1 dependencies via GmailContext,
    // keeping them pure L2 with zero cross-layer imports.
    {
      name: 'only-context-imports-client',
      severity: 'error',
      comment:
        'Only api/context.ts may import from client/. Other api modules must receive L1 dependencies via GmailContext or loader functions.',
      from: {
        path: '^src/api/',
        pathNot: '^src/api/context\\.ts$',
      },
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
          '^src/api/[^/]+',
          '^src/mcp/[^/]+',
          '^src/infra/[^/]+',
          'node_modules/(@[^/]+/[^/]+|[^/]+)',
        ],
      },
      dot: {
        showMetrics: true,
      },
    },
  },
};
