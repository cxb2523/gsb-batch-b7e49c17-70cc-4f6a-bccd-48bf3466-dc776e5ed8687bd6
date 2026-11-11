import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    // The default 5 s is too tight on a busy machine: tests that mount several charts take
    // longer than that without anything being wrong.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/version.ts'],
      reporter: ['text-summary', 'lcov'],
      // Set a little below what the suite reaches, so CI catches a real slide rather than a
      // rounding difference. Raise them as the suite grows.
      thresholds: { statements: 85, branches: 75, functions: 90, lines: 90 },
    },
  },
});
