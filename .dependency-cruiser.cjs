/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  extends: 'dependency-cruiser/configs/recommended-strict',
  forbidden: [
    // --- Layer boundary enforcement ---
    // Architecture: Layer 1 (client/) ← Layer 2 (composed/) ← Layer 3 (mcp-server/)
    // Cross-cutting modules (shared/auth, shared/errors, shared/logger, shared/types) are accessible from any layer.
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
    {
      name: 'public-api-cannot-import-layer-3',
      severity: 'error',
      comment: 'Public API must not depend on MCP server (Layer 3).',
      from: { path: '^src/index\\.ts$' },
      to: { path: '^src/mcp-server' },
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
      name: 'no-deep-imports-into-composed',
      severity: 'error',
      comment: 'External consumers must use composed/index.ts, not reach into internal modules.',
      from: { pathNot: '^src/composed/' },
      to: { path: '^src/composed/', pathNot: '^src/composed/index\\.ts$' },
    },
    {
      name: 'no-deep-imports-into-shared',
      severity: 'error',
      comment: 'External consumers must use shared/index.ts, not reach into internal modules.',
      from: { pathNot: '^src/shared/' },
      to: { path: '^src/shared/', pathNot: '^src/shared/index\\.ts$' },
    },
    // --- Single point of contact: only context.ts bridges L2 → L1 ---
    // All other composed modules receive L1 dependencies via GmailContext,
    // keeping them pure L2 with zero cross-layer imports.
    {
      name: 'only-context-imports-client',
      severity: 'error',
      comment:
        'Only composed/context.ts may import from client/. Other composed modules must receive L1 dependencies via GmailContext or loader functions.',
      from: {
        path: '^src/composed/',
        pathNot: '^src/composed/context\\.ts$',
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
          '^src/composed/[^/]+',
          '^src/mcp-server/[^/]+',
          '^src/shared/[^/]+',
          'node_modules/(@[^/]+/[^/]+|[^/]+)',
        ],
      },
      dot: {
        showMetrics: true,
      },
    },
  },
};
