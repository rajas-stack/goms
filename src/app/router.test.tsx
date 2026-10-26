import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `adminImportRoutes` (router.tsx) is read from `import.meta.env.VITE_ADMIN_IMPORT_ENABLED`
// at module-load time, so switching modes needs a fresh module graph — see
// the same pattern in TopBar.test.tsx.
describe('login route', () => {
  it('registers /login as its own top-level route, outside AppLayout', async () => {
    const { router } = await import('./router')
    expect(router.routes.find((r) => r.path === '/login')).toBeDefined()
    expect(router.routes[0].children?.map((c) => c.path)).not.toContain('/login')
  }, 30_000)
})

describe('access routes', () => {
  it('serves Roles & Access at /settings/access and forwards the old /admin/access screens there', async () => {
    const { router } = await import('./router')
    const children = router.routes[0].children ?? []
    expect(children.map((c) => c.path)).toContain('/settings/access')
    expect(children.map((c) => c.path)).not.toContain('/admin/access/matrix')
    for (const path of ['/admin/access', '/admin/access/*']) {
      const legacy = children.find((c) => c.path === path)
      expect(JSON.stringify((legacy as { element?: unknown } | undefined)?.element, (_k, v) => (typeof v === 'function' ? v.name : v))).toContain('/settings/access')
    }
  }, 30_000)
})

describe('admin data import routes', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('registers /admin/data-import routes when VITE_ADMIN_IMPORT_ENABLED is true', async () => {
    vi.stubEnv('VITE_ADMIN_IMPORT_ENABLED', 'true')
    const { router } = await import('./router')
    const paths = router.routes[0].children?.map((c) => c.path)
    expect(paths).toContain('/admin/data-import')
    expect(paths).toContain('/admin/data-import/session')
    // The first import of ./router in this file pays the whole module graph's
    // cold-transform cost (~4.5s), right at vitest's 5s default.
  }, 30_000)

  it('omits /admin/data-import routes when VITE_ADMIN_IMPORT_ENABLED is unset (default)', async () => {
    vi.stubEnv('VITE_ADMIN_IMPORT_ENABLED', '')
    const { router } = await import('./router')
    const paths = router.routes[0].children?.map((c) => c.path)
    expect(paths).not.toContain('/admin/data-import')
    expect(paths).not.toContain('/admin/data-import/session')
  })

  it('registers both the geography panel and the session wizard routes', async () => {
    vi.stubEnv('VITE_ADMIN_IMPORT_ENABLED', 'true')
    const { router } = await import('./router')
    const paths = router.routes[0].children?.map((c) => c.path) ?? []
    expect(paths).toContain('/admin/data-import/geography')
    expect(paths).toContain('/admin/data-import/session')
  })

  it('registers /live-bids routes only when VITE_BID_TRACKER_ENABLED is true', async () => {
    vi.stubEnv('VITE_BID_TRACKER_ENABLED', 'true')
    const on = await import('./router')
    const onPaths = on.router.routes[0].children?.map((c) => c.path) ?? []
    expect(onPaths).toContain('/live-bids')
    expect(onPaths).toContain('/live-bids/:section')
    expect(onPaths).toContain('/live-bids/bid/:bidId')

    vi.resetModules()
    vi.stubEnv('VITE_BID_TRACKER_ENABLED', '')
    const off = await import('./router')
    const offPaths = off.router.routes[0].children?.map((c) => c.path) ?? []
    expect(offPaths).not.toContain('/live-bids')
    expect(offPaths).not.toContain('/live-bids/:section')
  })

  it('keeps the catch-all NotFound route last regardless of the flag', async () => {
    vi.stubEnv('VITE_ADMIN_IMPORT_ENABLED', 'true')
    const { router } = await import('./router')
    const children = router.routes[0].children ?? []
    expect(children[children.length - 1].path).toBe('*')
  })
})
