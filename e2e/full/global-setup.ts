import { chromium } from '@playwright/test';

/** Warms the Vite dev server (on-demand module compilation makes the first hit of each lazy route slow)
 *  so individual tests are not judged on cold-compile time. Best-effort: never fails the run. */
export default async function globalSetup(): Promise<void> {
  const base = process.env.BASE_URL || 'http://localhost:5173';
  const paths = ['/', '/map', '/state/0', '/directory', '/analytics', '/meetings', '/sales', '/teams', '/commercial-calculator',
    '/live-bids', '/live-bids/pipeline', '/live-bids/dashboard', '/settings', '/settings/access', '/settings/competitors',
    '/settings/masters/employees', '/settings/tender-websites', '/settings/dms', '/settings/integrations', '/settings/credentials',
    '/document-maker', '/documents/opportunity'];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const p of paths) {
      try { await page.goto(base + p, { waitUntil: 'networkidle', timeout: 90_000 }); } catch { /* best effort */ }
    }
  } finally {
    await browser.close();
  }
}
