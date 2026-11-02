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
      // A regression guard, checked only with --coverage (npm run test:coverage), never by `npm test`: 5 points
      // below the full-suite measurement of 2026-11-01 (statements 93.51, branches 87.37, functions 94.48,
      // lines 97.47), so normal churn passes and a large untested addition does not. Raise them after a
      // measurement shows the margin has grown; do not lower them to make a change pass.
      thresholds: { statements: 88, branches: 82, functions: 89, lines: 92 },
    },
  },
});
