import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './e2e/constants.js';

// The dev stack has dev login; a flag left in the shell must not turn its sessions into demo ones.
delete process.env.E2E_DEMO_SESSIONS;

export default defineConfig({
  testDir: './e2e',
  // Needs the production image: `pnpm run test:e2e:image`.
  testIgnore: 'production-image.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  // One retry in CI, where a shared runner can stall a step; locally a failure is a failure.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
