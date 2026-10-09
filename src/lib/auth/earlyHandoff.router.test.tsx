import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// I2 (final review): React Router's createBrowserRouter captures the INITIAL location when it is created, so a later history.replaceState is
// invisible to it and any functional setSearchParams would put the spent ?auth_code= back into the address bar. The side-effect module
// ./earlyHandoff therefore strips the handoff parameters BEFORE the router exists (main.tsx imports it first). jsdom is the real window.
vi.mock('@/lib/authPrompt', () => ({ setPendingAuthReason: vi.fn(), raiseAuthReason: vi.fn() }))

const fakeSession = () => ({ redeem: vi.fn(async () => {}), init: vi.fn(async () => {}), trackHandoff: vi.fn(), isSignedIn: vi.fn(() => false) })

async function loadWithUrl(url: string, provider: string, ua?: string) {
  vi.resetModules()
  vi.stubEnv('VITE_AUTH_PROVIDER', provider)
  if (ua) vi.stubGlobal('navigator', { userAgent: ua })
  window.history.replaceState(null, '', url)
  await import('./earlyHandoff')                                   // main.tsx's first import: runs before ./app/router is evaluated
  const { createBrowserRouter } = await import('react-router-dom')
  const router = createBrowserRouter([{ path: '*', element: null }])   // what ./app/router does at module load
  const bootstrap = await import('./bootstrap')
  return { router, bootstrap }
}

beforeEach(() => { window.history.replaceState(null, '', '/') })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('earlyHandoff: the handoff parameters are gone before the router is created', () => {
  it('oauth: the router\'s initial location has no auth_code (view=y survives) and the code is still redeemed exactly once', async () => {
    const { router, bootstrap } = await loadWithUrl('/sales?auth_code=SPENT&view=y', 'oauth')
    expect(router.state.location.search).toBe('?view=y')
    expect(window.location.search).toBe('?view=y')
    const session = fakeSession()
    await bootstrap.bootstrapAuth(session, window)
    expect(session.redeem).toHaveBeenCalledTimes(1)
    expect(session.redeem).toHaveBeenCalledWith('SPENT', 'web')
    expect(session.trackHandoff).toHaveBeenCalledTimes(1)
    router.dispose()
  })
  it('oauth: what a functional setSearchParams starts from (the router\'s own search string) no longer contains the spent code', async () => {
    const { router } = await loadWithUrl('/sales?auth_code=SPENT&view=y', 'oauth')
    const prev = new URLSearchParams(router.state.location.search)   // the `prev` a functional setSearchParams receives
    expect([...prev.keys()]).toEqual(['view'])
    router.dispose()
  })
  it('oauth: an auth_error is stripped the same way and still reaches the bootstrap prompt logic', async () => {
    const { router, bootstrap } = await loadWithUrl('/?auth_error=domain&view=y', 'oauth')
    expect(router.state.location.search).toBe('?view=y')
    const prompt = await import('@/lib/authPrompt')
    await bootstrap.bootstrapAuth(fakeSession(), window)
    expect(prompt.setPendingAuthReason).toHaveBeenCalledWith('forbidden')
    router.dispose()
  })
  it('oauth: the parameters are consumed once - a second bootstrap does not see a stale stash', async () => {
    const { router, bootstrap } = await loadWithUrl('/?auth_code=SPENT', 'oauth')
    const first = fakeSession(); await bootstrap.bootstrapAuth(first, window)
    const second = fakeSession(); await bootstrap.bootstrapAuth(second, window)
    expect(first.redeem).toHaveBeenCalledTimes(1)
    expect(second.redeem).not.toHaveBeenCalled()
    router.dispose()
  })
  it('firebase (the default): the URL is completely untouched and nothing is stashed', async () => {
    const { router, bootstrap } = await loadWithUrl('/sales?auth_code=SPENT&view=y', '')
    expect(window.location.search).toBe('?auth_code=SPENT&view=y')
    expect(router.state.location.search).toBe('?auth_code=SPENT&view=y')
    // a later bootstrap (should one ever be called) falls back to reading the URL itself, i.e. there is no stash
    const session = fakeSession()
    await bootstrap.bootstrapAuth(session, window)
    expect(session.redeem).toHaveBeenCalledWith('SPENT', 'web')
    router.dispose()
  })
  it('the Android shell path (its own deep-link handler) is untouched even with oauth', async () => {
    const { router } = await loadWithUrl('/sales?auth_code=SPENT&view=y', 'oauth', 'Mozilla/5.0 GOMSShell/2 GOMSScheme/com.gorms.app.dev')
    expect(window.location.search).toBe('?auth_code=SPENT&view=y')
    router.dispose()
  })
})
