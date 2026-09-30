import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `adminImportRoutes` (router.tsx) is read from `import.meta.env.VITE_ADMIN_IMPORT_ENABLED`
// at module-load time, so switching modes needs a fresh module graph — see
// the same pattern in TopBar.test.tsx / SettingsDialog.test.tsx.
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
  })

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

  it('registers /bid-tracker routes only when VITE_BID_TRACKER_ENABLED is true', async () => {
    vi.stubEnv('VITE_BID_TRACKER_ENABLED', 'true')
    const on = await import('./router')
    const onPaths = on.router.routes[0].children?.map((c) => c.path) ?? []
    expect(onPaths).toContain('/bid-tracker')
    expect(onPaths).toContain('/bid-tracker/:section')
    expect(onPaths).toContain('/bid-tracker/bid/:bidId')

    vi.resetModules()
    vi.stubEnv('VITE_BID_TRACKER_ENABLED', '')
    const off = await import('./router')
    const offPaths = off.router.routes[0].children?.map((c) => c.path) ?? []
    expect(offPaths).not.toContain('/bid-tracker')
    expect(offPaths).not.toContain('/bid-tracker/:section')
  })

  it('keeps the catch-all NotFound route last regardless of the flag', async () => {
    vi.stubEnv('VITE_ADMIN_IMPORT_ENABLED', 'true')
    const { router } = await import('./router')
    const children = router.routes[0].children ?? []
    expect(children[children.length - 1].path).toBe('*')
  })
})
