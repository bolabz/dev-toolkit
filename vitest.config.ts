import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Reset mock state and restore spied implementations between every test
    clearMocks: true,
    restoreMocks: true,
    // Raise the per-test timeout to 10 s (default 5 s is tight for async I/O)
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/mcp-server.ts', 'src/mcp-server/**'],
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        // Raise these thresholds as test coverage grows
        lines: 10,
        functions: 10,
        branches: 10,
        statements: 10,
      },
    },
  },
});
