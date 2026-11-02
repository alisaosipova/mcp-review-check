import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
    // `npm run test:coverage`. Counts only code the test processes import from src/: the e2e tests that spawn
    // dist/cli.js exercise more than this report shows, so a module low here may still be covered end to end.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // A flaky test elsewhere should not hide the numbers (vitest skips the report on a failed run by default).
      reportOnFailure: true,
      // A regression guard, checked only with --coverage (npm run test:coverage, and the CI coverage job), never by
      // `npm test`: 5 points below the full-suite measurement of 2026-11-02 with MCP_REVIEW_CHECK_COVERAGE=1
      // (statements 93.98, branches 88.46, functions 94.86, lines 97.72), rounded down, so normal churn passes and a
      // large untested addition does not. Raise them after a measurement shows the margin has grown; do not lower
      // them to make a change pass.
      thresholds: { statements: 88, branches: 83, functions: 89, lines: 92 },
    },
  },
});
