import { defineConfig, devices } from "@playwright/test";

const mockGitHub = "http://127.0.0.1:4545";

export default defineConfig({
  testDir: "./tests",
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node server.ts",
      url: "http://127.0.0.1:3000/healthz",
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
    // GitHub stub driving the degradation scenarios.
    {
      command: "node tests/mock-github.ts",
      url: `${mockGitHub}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    // Second dev server whose GitHub fetches go to the stub, so the
    // degradation tests never interfere with the main server's tests.
    {
      command: "node server.ts",
      url: "http://127.0.0.1:3001/healthz",
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env: {
        PORT: "3001",
        HOST: "127.0.0.1",
        NEXT_DIST_DIR: ".next-degraded",
        NEXT_NO_DATA_CACHE: "1",
        GITHUB_WEB_URL: mockGitHub,
        GITHUB_API_URL: mockGitHub,
        GITHUB_RAW_URL: mockGitHub,
      },
    },
  ],
});
