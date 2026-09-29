import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;
const MOCK_API_PORT = 4100;

// Smoke tests against a running admin web. Locally this starts `next dev` (or
// reuses one you already have running); in CI it tests the production build.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Optional: use an already-installed Chromium instead of Playwright's download.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: [
    {
      // A stand-in for the API (e2e/mock-api.mjs): CI has no API or database.
      command: `node e2e/mock-api.mjs`,
      url: `http://localhost:${MOCK_API_PORT}/v1/health`,
      reuseExistingServer: !process.env.CI,
      env: { MOCK_API_PORT: String(MOCK_API_PORT) },
    },
    {
      command: process.env.CI ? 'pnpm build && pnpm start' : 'pnpm dev',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        API_URL: `http://localhost:${MOCK_API_PORT}`,
        // The production build (CI) would otherwise close the MFA placeholder.
        ADMIN_MFA_STUB: 'allow',
        // The production server runs on plain http here.
        COOKIE_SECURE: 'false',
      },
    },
  ],
});
