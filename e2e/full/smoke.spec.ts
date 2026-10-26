import type { Page } from '@playwright/test';
import { test, expect, gotoApp, urlEndsWith } from './helpers';
import { STATIC_ROUTES, REDIRECTS } from './routes';

test.describe('smoke: every route loads', () => {
  for (const route of STATIC_ROUTES) {
    test(`@smoke route ${route.path} renders without errors`, async ({ page, errors }) => {
      await gotoApp(page, route.path);
      await expect(page.getByText(route.expect).first()).toBeVisible();
      await expect(page).toHaveURL(urlEndsWith(route.finalPath ?? route.path));
      // not blank: the shell plus real content
      const text = await page.locator('body').innerText();
      expect(text.trim().length).toBeGreaterThan(40);
      expect(errors.page, 'uncaught page errors').toEqual([]);
      expect(errors.console, 'console errors').toEqual([]);
    });
  }

  for (const r of REDIRECTS) {
    test(`@smoke legacy ${r.from} redirects to ${r.to}`, async ({ page }) => {
      await page.goto(r.from);
      await expect(page).toHaveURL(urlEndsWith(r.to));
    });
  }

  test('@smoke unknown route shows Not Found, not a blank screen', async ({ page }) => {
    await gotoApp(page, '/this/route/does-not-exist');
    await expect(page.getByText(/not found|404|does not exist|cannot find/i).first()).toBeVisible();
  });

  test('@smoke /login page renders outside the app shell', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText(/sign in|log in|google/i).first()).toBeVisible();
  });
});

test.describe('smoke: desktop left rail', () => {
  const RAIL: { name: string; url: RegExp }[] = [
    { name: 'Insights', url: /\/insights$/ },
    { name: 'Account Mapping', url: /\/map$/ },
    { name: 'Commercial Calculator', url: /\/commercial-calculator$/ },
    { name: 'Opportunity', url: /\/live-bids$/ },
    { name: 'Document maker', url: /\/document-maker$/ },
    { name: 'Teams', url: /\/teams$/ },
  ];
  for (const item of RAIL) {
    test(`@smoke rail button "${item.name}" navigates`, async ({ page }) => {
      await gotoApp(page, '/');
      await page.getByRole('navigation').getByRole('button', { name: item.name, exact: true }).click();
      await expect(page).toHaveURL(item.url);
    });
  }

  test('@regression old /directory links open the sidebar Directory on the same person', async ({ page }) => {
    await gotoApp(page, '/directory?sel=x&kind=employee');
    await expect(page).toHaveURL(/\/teams\/directory\?sel=x&kind=employee$/);
    await expect(page.getByRole('heading', { name: 'Directory' })).toBeVisible();
  });

  test('@smoke Amnex home logo returns to Home', async ({ page }) => {
    await gotoApp(page, '/directory');
    await page.getByRole('link', { name: 'Amnex home' }).click();
    await expect(page).toHaveURL(new URL('/', page.url()).href);
  });

  test('@regression Account Mapping secondary nav links (Map, Insights, Meetings)', async ({ page }) => {
    await gotoApp(page, '/map');
    // Directory moved to the sidebar; Account Mapping no longer lists it.
    await expect(page.getByRole('link', { name: 'Directory', exact: true })).toHaveCount(0);
    for (const [name, url] of [['Insights', /\/insights$/], ['Meetings', /\/meetings$/], ['Map', /\/map$/]] as const) {
      // Insights now has its own module navigation; return to Account Mapping for its other sections.
      if (name === 'Meetings') await page.getByRole('navigation').getByRole('button', { name: 'Account Mapping', exact: true }).click();
      await page.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(url);
    }
  });

  test('@regression Opportunity tab links (Live Bids, Pipeline, Campaign, Master, Dashboard)', async ({ page }) => {
    await gotoApp(page, '/live-bids');
    for (const [name, url] of [['Pipeline', /\/pipeline\/funnel$/], ['Campaign', /\/campaign$/], ['Master', /\/master$/], ['Dashboard', /\/dashboard$/], ['Live Bids', /\/live-bids$/]] as const) {
      await page.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(url);
    }
  });

  test('@regression Teams tabs navigate (Org, Employees, Sales, Pre-sales, Legal, Bid)', async ({ page }) => {
    await gotoApp(page, '/teams');
    for (const [name, url] of [['Employees', /\/teams\/employees$/], ['Sales', /\/teams\/sales/], ['Pre-sales', /\/teams\/preSales/], ['Legal', /\/teams\/legal/], ['Bid', /\/teams\/bid/], ['Org Structure', /\/teams(\/org)?$/]] as const) {
      await page.getByRole('button', { name, exact: true }).or(page.getByRole('link', { name, exact: true })).first().click();
      await expect(page).toHaveURL(url);
    }
  });

  test('@regression Commercial Calculator section tabs navigate', async ({ page }) => {
    await gotoApp(page, '/commercial-calculator');
    for (const [name, url] of [['Create BOQ', /create-boq$/], ['BOQ Management', /boq-management$/], ['Catalog', /catalog$/], ['Settings', /commercial-calculator\/settings$/], ['Dashboard', /dashboard$/]] as const) {
      await page.getByRole('button', { name, exact: true }).or(page.getByRole('link', { name, exact: true })).first().click();
      await expect(page).toHaveURL(url);
    }
  });
});

test.describe('smoke: mobile drawer', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('@smoke rail is hidden and hamburger drawer opens with every module', async ({ page }) => {
    await gotoApp(page, '/');
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Account Mapping', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Open menu' }).click();
    for (const name of ['Insights', 'Account Mapping', 'Commercial Calculator', 'Opportunity', 'Document maker', 'Teams']) {
      await expect(page.getByRole('dialog').getByText(name).first()).toBeVisible();
    }
  });

  test('@regression drawer navigates to Teams', async ({ page }) => {
    await gotoApp(page, '/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('dialog').getByText('Teams').first().click();
    await expect(page).toHaveURL(/\/teams/);
  });

  test('@regression drawer navigates to Document maker', async ({ page }) => {
    await gotoApp(page, '/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('dialog').getByText('Document maker').first().click();
    await expect(page).toHaveURL(/\/document-maker/);
  });

  test('@regression key pages have no horizontal overflow at 390px', async ({ page }) => {
    for (const path of ['/', '/directory', '/meetings', '/teams', '/settings']) {
      await gotoApp(page, path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(2);
    }
  });
});

test.describe('smoke: global search', () => {
  const box = (page: Page) => page.getByPlaceholder(/Search or ask/);

  test('@smoke Ctrl+K opens global search and Escape closes it', async ({ page }) => {
    await gotoApp(page, '/');
    await page.keyboard.press('Control+k');
    await expect(box(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(box(page)).toBeHidden();
  });

  test('@smoke Ctrl+Shift+F opens global search', async ({ page }) => {
    await gotoApp(page, '/directory');
    await page.keyboard.press('Control+Shift+f');
    await expect(box(page)).toBeVisible();
  });

  test('@regression plain Ctrl+F is not hijacked', async ({ page }) => {
    await gotoApp(page, '/directory');
    const prevented = await page.evaluate(() => {
      const ev = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true, bubbles: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(box(page)).toBeHidden();
  });

  test('@regression "/" opens search unless typing in a field', async ({ page }) => {
    await gotoApp(page, '/directory');
    await page.getByPlaceholder(/Search by name, designation/).click();
    await page.keyboard.type('/');
    await expect(box(page)).toBeHidden();
    await page.getByRole('heading', { name: 'Directory' }).click();
    await page.keyboard.press('/');
    await expect(box(page)).toBeVisible();
  });

  test('@smoke search button opens palette with suggestions', async ({ page }) => {
    await gotoApp(page, '/');
    await page.getByRole('button', { name: 'Search everything' }).click();
    await expect(box(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connected officers' })).toBeVisible();
  });

  test('@regression searching a seeded person returns a result and Clear resets', async ({ page }) => {
    await gotoApp(page, '/');
    await page.keyboard.press('Control+k');
    await box(page).fill('Priya');
    await expect(page.getByText('Priya Nair').first()).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(box(page)).toHaveValue('');
  });
});

test.describe('smoke: theme and settings dialog', () => {
  test('@smoke Ctrl+Shift+L toggles dark mode with pitch-black page background', async ({ page }) => {
    await gotoApp(page, '/');
    const html = page.locator('html');
    const wasDark = ((await html.getAttribute('class')) ?? '').includes('dark');
    await page.keyboard.press('Control+Shift+l');
    if (wasDark) await expect(html).not.toHaveClass(/dark/);
    else {
      await expect(html).toHaveClass(/dark/);
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)');
    }
    await page.keyboard.press('Control+Shift+l');
    if (wasDark) await expect(html).toHaveClass(/dark/);
    else await expect(html).not.toHaveClass(/dark/);
  });

  test('@regression profile menu: Light / Dark / Eye comfort pickers apply theme', async ({ page }) => {
    await gotoApp(page, '/');
    await page.getByRole('button', { name: 'Profile options' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)');
    await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.getByRole('menuitemradio', { name: 'Eye comfort', exact: true }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Eye comfort', exact: true })).toBeChecked();
    await expect(page.getByRole('slider', { name: 'Eye comfort strength' })).toBeVisible();
  });

  test('@regression dark theme persists across reload', async ({ page }) => {
    await gotoApp(page, '/');
    await page.getByRole('button', { name: 'Profile options' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('@smoke settings dialog lists the four groups and navigates into a page', async ({ page }) => {
    await gotoApp(page, '/');
    await page.getByRole('button', { name: 'Profile options' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    const dlg = page.getByRole('dialog', { name: 'Settings' });
    for (const g of ['System settings', 'Bid team settings', 'Pre-sales', 'Masters']) {
      await expect(dlg.getByRole('button', { name: new RegExp(g) })).toBeVisible();
    }
    await dlg.getByRole('button', { name: /Masters/ }).click();
    await dlg.getByRole('link', { name: /Employee Master/ }).click();
    await expect(page).toHaveURL(/\/settings\/masters\/employees$/);
  });

  test('@regression settings dialog: every group exposes its pages', async ({ page }) => {
    await gotoApp(page, '/');
    const expected: Record<string, string[]> = {
      'System settings': ['Integrations', 'DMS Settings', 'Credentials'],
      'Bid team settings': ['Tender websites', 'Document Verifications'],
      'Pre-sales': ['Competitors'],
      Masters: ['Employee Master'],
    };
    for (const [group, pages] of Object.entries(expected)) {
      await page.getByRole('button', { name: 'Profile options' }).click();
      await page.getByRole('menuitem', { name: 'Settings' }).click();
      const dlg = page.getByRole('dialog', { name: 'Settings' });
      await dlg.getByRole('button', { name: new RegExp(group) }).click();
      for (const p of pages) await expect(dlg.getByRole('link', { name: new RegExp(p, 'i') })).toBeVisible();
      if (group === 'System settings') {
        await expect(dlg.getByRole('link', { name: 'Roles & Access' })).toHaveCount(0);
      }
      await page.keyboard.press('Escape');
      await expect(dlg).toBeHidden();
    }
  });

  test('@smoke /settings landing page lists all groups', async ({ page }) => {
    await gotoApp(page, '/settings');
    for (const g of ['System settings', 'Bid team settings', 'Pre-sales', 'Masters']) {
      await expect(page.getByRole('button', { name: new RegExp(g) }).first()).toBeVisible();
    }
  });
});
