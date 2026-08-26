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
    expect(paths).toContain('/admin/data-import/:domain')
  })

  it('omits /admin/data-import routes when VITE_ADMIN_IMPORT_ENABLED is unset (default)', async () => {
    vi.stubEnv('VITE_ADMIN_IMPORT_ENABLED', '')
    const { router } = await import('./router')
    const paths = router.routes[0].children?.map((c) => c.path)
    expect(paths).not.toContain('/admin/data-import')
    expect(paths).not.toContain('/admin/data-import/:domain')
  })

  it('keeps the catch-all NotFound route last regardless of the flag', async () => {
    vi.stubEnv('VITE_ADMIN_IMPORT_ENABLED', 'true')
    const { router } = await import('./router')
    const children = router.routes[0].children ?? []
    expect(children[children.length - 1].path).toBe('*')
  })
})
