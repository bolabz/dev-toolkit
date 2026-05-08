/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  extends: 'dependency-cruiser/configs/recommended-strict',
  forbidden: [
    // --- Layer boundary enforcement (within the gmail module) ---
    // Architecture: Layer 1 (gmail/client/) ← Layer 2 (gmail/api/) ← Layer 3 (gmail/mcp/)
    // Cross-cutting modules (gmail/infra/auth, errors, logger, types) are accessible from any layer.
    {
      name: 'layer-1-cannot-import-layer-2',
      severity: 'error',
      comment: 'Client (Layer 1) must not depend on api operations (Layer 2).',
      from: { path: '^src/gmail/client/' },
      to: { path: '^src/gmail/api/' },
    },
    {
      name: 'layer-1-cannot-import-layer-3',
      severity: 'error',
      comment: 'Client (Layer 1) must not depend on MCP server (Layer 3).',
      from: { path: '^src/gmail/client/' },
      to: { path: '^src/gmail/mcp' },
    },
    {
      name: 'layer-2-cannot-import-layer-3',
      severity: 'error',
      comment: 'Composed operations (Layer 2) must not depend on MCP server (Layer 3).',
      from: { path: '^src/gmail/api/' },
      to: { path: '^src/gmail/mcp' },
    },
    {
      name: 'layer-3-cannot-import-layer-1',
      severity: 'error',
      comment:
        'MCP server (Layer 3) must use GmailContext from Layer 2, not import Layer 1 directly.',
      from: { path: '^src/gmail/mcp' },
      to: { path: '^src/gmail/client/' },
    },
    {
      name: 'gmail-barrel-cannot-import-layer-1',
      severity: 'error',
      comment: 'Gmail module barrel must depend on Layer 2 (api), not Layer 1 (client) directly.',
      from: { path: '^src/gmail/index\\.ts$' },
      to: { path: '^src/gmail/client/' },
    },
    {
      name: 'gmail-barrel-cannot-import-layer-3',
      severity: 'error',
      comment: 'Gmail module barrel must not depend on MCP server (Layer 3).',
      from: { path: '^src/gmail/index\\.ts$' },
      to: { path: '^src/gmail/mcp' },
    },
    // --- Top-level toolkit barrel: only re-exports module barrels ---
    // src/index.ts is the toolkit-wide entry point that exposes module namespaces.
    // It must not reach into a module's internals — only import the module's own index.ts.
    {
      name: 'toolkit-barrel-must-use-module-barrel',
      severity: 'error',
      comment:
        'Top-level src/index.ts must only import module barrels (e.g. src/gmail/index.ts), not module internals.',
      from: { path: '^src/index\\.ts$' },
      to: { path: '^src/gmail/(?!index\\.ts$)' },
    },
    // --- Barrel-only cross-layer imports ---
    // External consumers of a layer must go through the layer's index.ts (public API).
    // Prevents deep imports that bypass the encapsulation boundary.
    {
      name: 'no-deep-imports-into-client',
      severity: 'error',
      comment:
        'External consumers must use gmail/client/index.ts, not reach into internal modules.',
      from: { pathNot: '^src/gmail/client/' },
      to: { path: '^src/gmail/client/', pathNot: '^src/gmail/client/index\\.ts$' },
    },
    {
      name: 'no-deep-imports-into-api',
      severity: 'error',
      comment: 'External consumers must use gmail/api/index.ts, not reach into internal modules.',
      from: { pathNot: '^src/gmail/api/' },
      to: { path: '^src/gmail/api/', pathNot: '^src/gmail/api/index\\.ts$' },
    },
    {
      name: 'no-deep-imports-into-infra',
      severity: 'error',
      comment: 'External consumers must use gmail/infra/index.ts, not reach into internal modules.',
      from: { pathNot: '^src/gmail/infra/' },
      to: { path: '^src/gmail/infra/', pathNot: '^src/gmail/infra/index\\.ts$' },
    },
    // --- Single point of contact: only context.ts bridges L2 → L1 ---
    // All other api modules receive L1 dependencies via GmailContext,
    // keeping them pure L2 with zero cross-layer imports.
    {
      name: 'only-context-imports-client',
      severity: 'error',
      comment:
        'Only gmail/api/context.ts may import from gmail/client/. Other api modules must receive L1 dependencies via GmailContext or loader functions.',
      from: {
        path: '^src/gmail/api/',
        pathNot: '^src/gmail/api/context\\.ts$',
      },
      to: { path: '^src/gmail/client/' },
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
          '^src/gmail/client/[^/]+',
          '^src/gmail/api/[^/]+',
          '^src/gmail/mcp/[^/]+',
          '^src/gmail/infra/[^/]+',
          'node_modules/(@[^/]+/[^/]+|[^/]+)',
        ],
      },
      dot: {
        showMetrics: true,
      },
    },
  },
};
