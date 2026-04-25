import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.integration.test.ts'],
    // Network I/O needs generous timeouts
    testTimeout: 30_000,
    // Show every test name + timing + console output
    reporters: ['verbose'],
    // No mocks — these hit the real Gmail API
    clearMocks: false,
    restoreMocks: false,
    // No coverage — integration tests only exercise the happy path.
    // Coverage thresholds belong on unit tests where edge cases are tested.
    coverage: { enabled: false },
  },
});
