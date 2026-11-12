import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    restoreMocks: true,
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/main.ts',
        'src/app.setup.ts',
        'src/**/*.module.ts',
        'src/config/validate-env.ts',
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 83,
        branches: 72,
        functions: 88,
        lines: 83,
      },
    },
  },
});
