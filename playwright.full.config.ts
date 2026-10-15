import { defineConfig, devices } from '@playwright/test';

/** Full-surface E2E suite (e2e/full). Runs against the local Vite dev server in local mode
 *  (no VITE_API_BASE_URL -> in-memory/IndexedDB repository, no sign-in, permissions open).
 *  Never starts/stops the dev server; it must already be running on :5173. */
export default defineConfig({
  testDir: './e2e/full',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  retries: 1,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-full', open: 'never' }]],
  outputDir: 'test-results-full',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
