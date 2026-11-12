import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the specs that work on the production image, which runs in demo mode (no dev login) at
 * E2E_IMAGE_URL, default http://localhost:3100. See e2e/README.md.
 *
 * Sessions are demo accounts (`E2E_DEMO_SESSIONS`). Specs that need dev login, a second sign-in of
 * the same person, or people's display names stay on the dev stack.
 */
const imageUrl = process.env.E2E_IMAGE_URL ?? 'http://localhost:3100';
process.env.E2E_BASE_URL = imageUrl;
process.env.E2E_API_URL = imageUrl;
process.env.E2E_DEMO_SESSIONS = 'true';

export default defineConfig({
  testDir: './e2e',
  testMatch: [
    'production-image.spec.ts',
    'images-and-conflicts.spec.ts',
    'canvas-saving.spec.ts',
    'two-user-access.spec.ts',
    'notifications.spec.ts',
    'key-rotation.spec.ts',
    'workspace-key-rotation.spec.ts',
    'rekey-job.spec.ts',
    'workspace-lifecycle.spec.ts',
  ],
  workers: 1,
  reporter: 'list',
  use: { baseURL: imageUrl },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
