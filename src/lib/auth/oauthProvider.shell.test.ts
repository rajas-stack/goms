import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Inside the Android shell the module-level `inShell` flag and the token store are fixed at import time, so every test loads a fresh
// copy of oauthProvider with its own user agent / plugin set. Capacitor plugins are mocked at the module boundary.
const env = vi.hoisted(() => ({ plugins: new Set<string>(), assign: vi.fn(), setItem: vi.fn(), getItem: vi.fn(() => null), removeItem: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isPluginAvailable: (p: string) => env.plugins.has(p) } }))

const native = { openNativeSignIn: vi.fn(async () => {}), listenForAuthDeepLinks: vi.fn(async () => {}), createSecureTokenStore: vi.fn() }

async function load(ua: string, plugins: string[]) {
  vi.resetModules()
  env.plugins = new Set(plugins)
  vi.stubGlobal('navigator', { userAgent: ua })
  vi.stubGlobal('window', { location: { pathname: '/', search: '', href: 'https://goms.test/', origin: 'https://goms.test', assign: env.assign }, history: { replaceState: vi.fn(), state: null } })
  vi.stubGlobal('localStorage', { getItem: env.getItem, setItem: env.setItem, removeItem: env.removeItem })
  vi.stubEnv('VITE_API_BASE_URL', 'https://goms.test')
  vi.doMock('./native', () => native)
  return import('./oauthProvider')
}
const SHELL_UA = 'Mozilla/5.0 GOMSShell/2 GOMSScheme/com.gorms.app.dev'
const ALL = ['SecureStorage', 'Browser', 'App']

beforeEach(() => { env.assign.mockReset(); env.setItem.mockReset(); env.getItem.mockReset().mockReturnValue(null); env.removeItem.mockReset(); Object.values(native).forEach((f) => f.mockReset()) })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('oauthProvider.signIn inside the Android shell', () => {
  it('with every capability it opens the SYSTEM browser at /start?client=app and never changes the WebView location', async () => {
    const { oauthProvider, inShell } = await load(SHELL_UA, ALL)
    expect(inShell).toBe(true)
    await oauthProvider.signIn()
    expect(native.openNativeSignIn).toHaveBeenCalledTimes(1)
    expect(env.assign).not.toHaveBeenCalled()
    expect(env.setItem).not.toHaveBeenCalled()
  })
  it.each([
    ['secureStorage', ['Browser', 'App']],
    ['browser', ['SecureStorage', 'App']],
    ['appLinks', ['SecureStorage', 'Browser']],
    ['all of them (an old shell reporting version 1)', []],
  ])('refuses BEFORE any navigation or Browser.open when %s is missing, and writes nothing to localStorage', async (_name, plugins) => {
    const { oauthProvider } = await load(SHELL_UA, plugins)
    await expect(oauthProvider.signIn()).rejects.toMatchObject({ name: 'ShellUpdateRequiredError' })
    expect(native.openNativeSignIn).not.toHaveBeenCalled()
    expect(env.assign).not.toHaveBeenCalled()
    expect(env.setItem).not.toHaveBeenCalled()
  })
  it('an old shell (version below the native pieces) is refused even when the plugins report themselves present', async () => {
    const { oauthProvider } = await load('Mozilla/5.0 GOMSShell/1 GOMSScheme/com.gorms.app', ALL)
    await expect(oauthProvider.signIn()).rejects.toMatchObject({ name: 'ShellUpdateRequiredError' })
    expect(native.openNativeSignIn).not.toHaveBeenCalled()
    expect(env.assign).not.toHaveBeenCalled()
  })
  it('a failing Browser.open surfaces as a rejection (the dialog shows the generic failure) and still touches no localStorage', async () => {
    native.openNativeSignIn.mockRejectedValue(new Error('no custom tab'))
    const { oauthProvider } = await load(SHELL_UA, ALL)
    await expect(oauthProvider.signIn()).rejects.toThrow('no custom tab')
    expect(env.assign).not.toHaveBeenCalled(); expect(env.setItem).not.toHaveBeenCalled()
  })
})

describe('oauthProvider.bootstrap inside the Android shell', () => {
  it('a complete shell registers the deep-link listener for its own scheme, then restores the session', async () => {
    const { oauthProvider } = await load(SHELL_UA, ALL)
    await oauthProvider.bootstrap()
    expect(native.listenForAuthDeepLinks).toHaveBeenCalledWith('com.gorms.app.dev', expect.any(Function), expect.any(Function))
  })
  it.each([
    ['an old shell without the capabilities', 'Mozilla/5.0 GOMSShell/1 GOMSScheme/com.gorms.app', []],
    ['an incomplete shell (no App/appLinks plugin)', SHELL_UA, ['SecureStorage', 'Browser']],
    ['an incomplete shell (no SecureStorage plugin)', SHELL_UA, ['Browser', 'App']],
    ['a shell that reports no (or an unknown) scheme', 'Mozilla/5.0 GOMSShell/2 GOMSScheme/com.evil.app', ALL],
  ])('R4: %s still finishes bootstrap with loading=false and a signed-out state, and writes nothing to localStorage', async (_name, ua, plugins) => {
    const { oauthProvider } = await load(ua, plugins)
    const seen: Array<[unknown, boolean]> = []
    oauthProvider.subscribe((u, loading) => seen.push([u, loading]))
    expect(seen[0]).toEqual([null, true])            // loading until bootstrap settles...
    await oauthProvider.bootstrap()
    expect(seen[seen.length - 1]).toEqual([null, false])       // ...then the auth gate can render, signed out
    expect(native.listenForAuthDeepLinks).not.toHaveBeenCalled()
    expect(env.setItem).not.toHaveBeenCalled()
    expect(env.getItem).not.toHaveBeenCalled()
  })
})

describe('oauthProvider in a plain browser is unchanged', () => {
  it('signIn still does the full-page web redirect and never loads the native module', async () => {
    const { oauthProvider, inShell } = await load('Mozilla/5.0 Chrome/120', [])
    expect(inShell).toBe(false)
    await oauthProvider.signIn()
    expect(env.assign).toHaveBeenCalledTimes(1)
    expect(String(env.assign.mock.calls[0][0])).toContain('client=web')
    expect(native.openNativeSignIn).not.toHaveBeenCalled()
  })
})
