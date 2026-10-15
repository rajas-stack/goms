import { test as base, expect, type Page, type Locator } from '@playwright/test';

/** Console noise that is environmental (no API in local mode, dev-server HMR, fonts, third-party iframes). */
const IGNORED_CONSOLE = [
  /favicon/i,
  /Failed to load resource/i,
  /\[vite\]/i,
  /Download the React DevTools/i,
  /ResizeObserver loop/i,
  /net::ERR_/i,
  /googleapis|gstatic|accounts\.google|firebase/i,
  /Content Security Policy/i,
  /Manifest/i,
  /ServiceWorker|service worker/i,
];

export interface PageErrors {
  console: string[];
  page: string[];
}

/** `test` with an `errors` fixture: every console.error and uncaught page error is collected per test. */
export const test = base.extend<{ errors: PageErrors }>({
  errors: async ({ page }, use) => {
    const errors: PageErrors = { console: [], page: [] };
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      errors.console.push(text.slice(0, 300));
    });
    page.on('pageerror', (e) => errors.page.push(e.message.slice(0, 300)));
    await use(errors);
  },
});
export { expect };

/** Opens a route and waits until the app shell has rendered (top bar present, no error boundary). */
export async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Profile options' })).toBeVisible({ timeout: 30_000 });
  await expectNoErrorScreen(page);
}

export async function expectNoErrorScreen(page: Page): Promise<void> {
  await expect(page.getByText(/something went wrong|unexpected error|application error/i)).toHaveCount(0);
}

/** Dialog helpers -------------------------------------------------------- */
export function dialog(page: Page, name?: string | RegExp): Locator {
  return name ? page.getByRole('dialog', { name }) : page.getByRole('dialog').last();
}

/** Picks an option in a role=combobox (typeahead) control: types the text, clicks the matching option. */
export async function pickCombobox(page: Page, combo: Locator, text: string): Promise<void> {
  await combo.click();
  await combo.fill(text);
  await page.getByRole('option', { name: new RegExp(escapeRe(text), 'i') }).first().click();
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Unique, human-readable suffix so tests never collide on names. */
export function uniq(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

/** Unlocks an edit-locked grid/roster ("... editing locked - tap to unlock") if it is locked. */
export async function unlockIfLocked(page: Page): Promise<void> {
  const lock = page.getByRole('button', { name: /editing locked/i }).first();
  if (await lock.isVisible().catch(() => false)) await lock.click();
}

export const urlEndsWith = (path: string): RegExp => new RegExp(`${escapeRe(path)}$`);
