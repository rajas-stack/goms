import { expect, test, type Page } from '@playwright/test'

// MOCKED-ROLE TEST. `auth.me` is faked in the browser to report several roles, so this exercises the real Vite UI (profile menu,
// permissions provider, rail) but does NOT verify real Google sign-in, the real server's role derivation, or server-side RBAC
// enforcement. The role switcher only narrows what the UI shows; the server still authorises with the user's full role set.
//
// Needs a LOCAL app whose data layer talks to an API (so the UI calls `auth.me`), e.g. the SSO-mode dev server:
//   npx vite --config vite.sso.config.ts --mode sso --port 3000 --strictPort
//   BASE_URL=http://localhost:3000 npx playwright test e2e/role-switcher.spec.ts
// It refuses to run against any non-local BASE_URL (the default is the hosted goms-dev site).
// Anchored on the host boundary so lookalikes (http://localhost.evil.com, http://localhost@evil.com) are refused too.
test.skip(!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(process.env.BASE_URL ?? ''), 'local, API-backed dev server only (set BASE_URL=http://localhost:3000)')

const EMAIL = 'multi@amnex.com'
const FACTS = { salesPersonId: null, teamMemberIds: { presales: [], legal: [], bid: [] } }

async function mockAuthMe(page: Page, roles: string[], mode = 'enforce') {
  const me = { mode, email: EMAIL, roles, facts: mode === 'enforce' ? FACTS : null }
  await page.route('**/api/trpc/**', async (route) => {
    const paths = decodeURIComponent(new URL(route.request().url()).pathname.split('/api/trpc/')[1] ?? '').split(',')
    const at = paths.indexOf('auth.me')
    if (at === -1) return route.continue()
    const body = { result: { data: me } }
    if (paths.length === 1) return route.fulfill({ json: [body] })
    // auth.me was batched with other calls: let the real API answer those and replace only our slot.
    const real = await route.fetch()
    const arr = (await real.json()) as unknown[]
    arr[at] = body
    return route.fulfill({ response: real, json: arr })
  })
}

const openMenu = (page: Page) => page.getByRole('button', { name: 'Profile options' }).click()
const commercial = (page: Page) => page.getByTitle('Commercial Calculator')

test.describe('role switcher (mocked auth.me)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('lists the reported roles, narrows the UI to one role, persists it, and All my roles restores the union', async ({ page }) => {
    await mockAuthMe(page, ['sales', 'legal'])
    await page.goto('/')

    // "All my roles" (default): the union. Sales can open the Commercial Calculator; Legal alone cannot.
    await expect(commercial(page)).toBeVisible()
    await openMenu(page)
    const group = page.getByRole('group', { name: 'Role' })
    await expect(group.getByRole('menuitemradio')).toHaveText(['All my roles', 'Sales', 'Legal'])
    await expect(group.getByRole('menuitemradio', { name: 'All my roles' })).toHaveAttribute('aria-checked', 'true')
    await expect(group).toContainText('actual access is decided by the server')

    // Narrow to Legal: the Commercial Calculator entry disappears (a view-only narrowing).
    await group.getByRole('menuitemradio', { name: 'Legal' }).click()
    await expect(group.getByRole('menuitemradio', { name: 'Legal' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expect(commercial(page)).toHaveCount(0)

    // The choice survives a reload (stored per user in this browser).
    await page.reload()
    await expect(commercial(page)).toHaveCount(0)
    await openMenu(page)
    await expect(page.getByRole('menuitemradio', { name: 'Legal' })).toHaveAttribute('aria-checked', 'true')

    // Back to the full union.
    await page.getByRole('menuitemradio', { name: 'All my roles' }).click()
    await page.keyboard.press('Escape')
    await expect(commercial(page)).toBeVisible()
  })

  test('hides the switcher for a single-role user and ignores a saved role the server no longer reports', async ({ page }) => {
    await page.addInitScript(([k]) => localStorage.setItem(k, 'finance'), [`goms.activeRole:${EMAIL}`])
    await mockAuthMe(page, ['sales'])
    await page.goto('/')
    await expect(commercial(page)).toBeVisible()
    await openMenu(page)
    await expect(page.getByRole('group', { name: 'Role' })).toHaveCount(0)
  })

  test('a stale saved role is discarded when the server reports several other roles', async ({ page }) => {
    await page.addInitScript(([k]) => localStorage.setItem(k, 'finance'), [`goms.activeRole:${EMAIL}`])
    await mockAuthMe(page, ['sales', 'legal'])
    await page.goto('/')
    await expect(commercial(page)).toBeVisible() // still the union, not narrowed to the stale value
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), `goms.activeRole:${EMAIL}`)).toBeNull()
  })

  test('shows no switcher while RBAC is not enforced (shadow): everything stays visible', async ({ page }) => {
    await mockAuthMe(page, ['sales', 'legal'], 'shadow')
    await page.goto('/')
    await expect(commercial(page)).toBeVisible()
    await openMenu(page)
    await expect(page.getByRole('group', { name: 'Role' })).toHaveCount(0)
  })
})
