import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cap } = vi.hoisted(() => ({
  cap: {
    open: vi.fn(), close: vi.fn(async () => {}), listener: null as null | ((e: { url: string }) => void), launchUrl: null as null | { url: string },
    store: new Map<string, string>(), secureAvailable: true, getArgs: [] as unknown[][],
    storageFault: false,
  },
}))
vi.mock('@capacitor/browser', () => ({ Browser: { open: cap.open, close: cap.close } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: async (_e: string, cb: (e: { url: string }) => void) => { cap.listener = cb; return { remove: async () => {} } }, getLaunchUrl: async () => cap.launchUrl } }))
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    get: async (k: string, ...rest: unknown[]) => { cap.getArgs.push([k, ...rest]); if (cap.storageFault) throw new Error('keystore'); return cap.store.get(k) ?? null },
    set: async (k: string, v: string) => { if (cap.storageFault) throw new Error('keystore'); cap.store.set(k, v) },
    remove: async (k: string) => { cap.store.delete(k); return true },
  },
}))
// Native availability is decided ONLY through hasCapability (never Capacitor.isNativePlatform).
vi.mock('@/lib/nativeShell', () => ({ hasCapability: () => cap.secureAvailable }))
import { createSecureTokenStore, listenForAuthDeepLinks, openNativeSignIn, parseAuthDeepLink } from './native'

const CODE = 'A'.repeat(43)
beforeEach(() => {
  cap.open.mockReset(); cap.close.mockClear(); cap.listener = null; cap.launchUrl = null; cap.store.clear()
  cap.secureAvailable = true; cap.storageFault = false; cap.getArgs = []
  vi.stubGlobal('window', { location: { origin: 'https://goms-dev.firebaseapp.com' } })
})

describe("parseAuthDeepLink — strict, and only for THIS flavor's own scheme", () => {
  it('reads a well-formed code or a known error reason', () => {
    expect(parseAuthDeepLink(`com.gorms.app://auth?code=${CODE}`, 'com.gorms.app')).toEqual({ code: CODE })
    expect(parseAuthDeepLink('com.gorms.app.dev://auth?error=domain', 'com.gorms.app.dev')).toEqual({ error: 'domain' })
  })
  it.each(['state', 'domain', 'unverified', 'google', 'denied'])('accepts the error reason %s', (reason) => {
    expect(parseAuthDeepLink(`com.gorms.app://auth?error=${reason}`, 'com.gorms.app')).toEqual({ error: reason })
  })
  it('the dev app ignores a prod link and the prod app ignores a dev link (side-by-side installs)', () => {
    expect(parseAuthDeepLink(`com.gorms.app://auth?code=${CODE}`, 'com.gorms.app.dev')).toBeNull()
    expect(parseAuthDeepLink(`com.gorms.app.dev://auth?code=${CODE}`, 'com.gorms.app')).toBeNull()
  })
  it.each([
    `https://evil.example/auth?code=${CODE}`, `com.gorms.app://other?code=${CODE}`, `com.other.app://auth?code=${CODE}`, 'not a url', 'com.gorms.app://auth',
    'com.gorms.app://auth?code=ABC',                                   // wrong length
    `com.gorms.app://auth?code=${'A'.repeat(42)}!`,                    // wrong alphabet
    `com.gorms.app://auth?code=${CODE}&code=${CODE}`,                  // repeated
    `com.gorms.app://auth?code=${CODE}&x=1`,                           // extra parameter
    `com.gorms.app://auth?code=${CODE}&error=domain`,                  // both
    'com.gorms.app://auth?error=anything-else',                        // unknown reason
    'com.gorms.app://auth?error=domain&error=state',                   // repeated error
    `com.gorms.app://auth?code=${'A'.repeat(44)}`,                     // too long
    `com.gorms.app://auth?x=${CODE}`,                                  // unknown parameter name
    `com.gorms.app://auth/extra?code=${CODE}`, `com.gorms.app://auth?code=${CODE}#frag`, `com.gorms.app://user@auth?code=${CODE}`,
  ])('ignores %s', (u) => { expect(parseAuthDeepLink(u, 'com.gorms.app')).toBeNull() })
  it('ignores everything when the shell reports no scheme', () => { expect(parseAuthDeepLink(`com.gorms.app://auth?code=${CODE}`, null)).toBeNull() })

  // I4 (final review): parsing is by the exact RAW prefix `<scheme>://auth?`, never through `new URL`, because WebViews before Chromium M130
  // parse a custom-scheme URL with host '' and pathname '//auth' (so a host check rejected every link and sign-in silently did nothing).
  it('does not depend on the platform URL parser: it works when URL throws, and when URL behaves like pre-M130 Chromium (host "", pathname "//auth")', () => {
    class OldChromiumUrl {
      protocol: string; host = ''; pathname = '//auth'; username = ''; password = ''; hash = ''; searchParams: URLSearchParams
      constructor(u: string) { this.protocol = `${u.split(':')[0]}:`; this.searchParams = new URLSearchParams(u.split('?')[1] ?? '') }
    }
    class ThrowingUrl { constructor() { throw new TypeError('Invalid URL') } }
    for (const Impl of [OldChromiumUrl, ThrowingUrl]) {
      vi.stubGlobal('URL', Impl)
      try {
        expect(parseAuthDeepLink(`com.gorms.app.dev://auth?code=${CODE}`, 'com.gorms.app.dev')).toEqual({ code: CODE })
        expect(parseAuthDeepLink('com.gorms.app.dev://auth?error=google', 'com.gorms.app.dev')).toEqual({ error: 'google' })
      } finally { vi.unstubAllGlobals() }
    }
  })
  it.each([
    [`COM.GORMS.APP://auth?code=${CODE}`, 'com.gorms.app'],             // the scheme is matched case-sensitively
    [`Com.Gorms.App://auth?code=${CODE}`, 'com.gorms.app'],
    [`com.gorms.app://AUTH?code=${CODE}`, 'com.gorms.app'],             // and so is the host
    [`com.gorms.app://auth?code=%41${'A'.repeat(42)}`, 'com.gorms.app'], // a percent-encoded code value (decodes to 43 valid chars) is rejected
    [`com.gorms.app://auth?code=${'A'.repeat(42)}%41`, 'com.gorms.app'],
    ['com.gorms.app://auth?error=%64omain', 'com.gorms.app'],
    [`com.gorms.app://auth?%63ode=${CODE}`, 'com.gorms.app'],           // nor an encoded key
    [`com.gorms.app://auth?code=${CODE}#frag`, 'com.gorms.app'],        // a fragment
    ['com.gorms.app://auth?error=domain#x', 'com.gorms.app'],
    [`com.gorms.app://auth?code=${CODE}&`, 'com.gorms.app'],            // stray separator
    [`com.gorms.app://auth?&code=${CODE}`, 'com.gorms.app'],
    [`com.gorms.app://auth/?code=${CODE}`, 'com.gorms.app'],            // a path
    [`com.gorms.app://auth:443?code=${CODE}`, 'com.gorms.app'],         // a port
    [`com.gorms.app://user:pw@auth?code=${CODE}`, 'com.gorms.app'],     // userinfo
    [`com.gorms.app:///auth?code=${CODE}`, 'com.gorms.app'],
    [`com.gorms.app:/auth?code=${CODE}`, 'com.gorms.app'],
    [` com.gorms.app://auth?code=${CODE}`, 'com.gorms.app'],            // leading whitespace
    [`com.gorms.app://auth?code=${CODE} `, 'com.gorms.app'],
    [`com.gorms.app.dev://auth?code=${CODE}`, 'com.gorms.app'],         // the other flavor's scheme (a prefix lookalike)
    [`com.gorms.app://auth?code=${CODE}`, 'com.gorms.app.dev'],
  ])('rejects %s (scheme %s)', (u, scheme) => { expect(parseAuthDeepLink(u, scheme)).toBeNull() })
  it('rejects a non-string input instead of throwing', () => {
    expect(parseAuthDeepLink(undefined as unknown as string, 'com.gorms.app')).toBeNull()
  })
})

describe('openNativeSignIn', () => {
  it("opens the system browser at /start?client=app on the page's own (pinned) origin", async () => {
    await openNativeSignIn()
    expect(cap.open).toHaveBeenCalledWith({ url: 'https://goms-dev.firebaseapp.com/api/oauth/google/start?client=app' })
  })
  it("refuses any origin other than the page's own", async () => {
    await expect(openNativeSignIn('https://evil.example')).rejects.toThrow()
    expect(cap.open).not.toHaveBeenCalled()
  })
})

describe('listenForAuthDeepLinks', () => {
  it('handles a warm deep link, closes the browser, and ignores unrelated or foreign-scheme URLs', async () => {
    const handler = vi.fn(async () => {})
    await listenForAuthDeepLinks('com.gorms.app.dev', handler)
    cap.listener!({ url: 'https://elsewhere.example/' })
    cap.listener!({ url: `com.gorms.app://auth?code=${CODE}` }) // the OTHER flavor's scheme
    expect(handler).not.toHaveBeenCalled()
    cap.listener!({ url: `com.gorms.app.dev://auth?code=${CODE}` })
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ code: CODE }))
    expect(cap.close).toHaveBeenCalled()
  })
  it('also handles the link that cold-started the app', async () => {
    cap.launchUrl = { url: `com.gorms.app://auth?code=${'B'.repeat(43)}` }
    const handler = vi.fn(async () => {})
    await listenForAuthDeepLinks('com.gorms.app', handler)
    expect(handler).toHaveBeenCalledWith({ code: 'B'.repeat(43) })
  })
  it('I8: the link that launched the app goes to the separate launch handler (when given); warm links keep going to the main handler', async () => {
    cap.launchUrl = { url: `com.gorms.app://auth?code=${'B'.repeat(43)}` }
    const warm = vi.fn(async () => {}); const launch = vi.fn(async () => {})
    await listenForAuthDeepLinks('com.gorms.app', warm, launch)
    expect(launch).toHaveBeenCalledWith({ code: 'B'.repeat(43) })
    expect(warm).not.toHaveBeenCalled()
    cap.listener!({ url: `com.gorms.app://auth?error=domain` })
    await vi.waitFor(() => expect(warm).toHaveBeenCalledWith({ error: 'domain' }))
    expect(launch).toHaveBeenCalledTimes(1)
  })
  it('never hands the same link to the handler twice (launch URL re-delivered as a warm link): a code is one-time', async () => {
    cap.launchUrl = { url: `com.gorms.app://auth?code=${CODE}` }
    const handler = vi.fn(async () => {})
    await listenForAuthDeepLinks('com.gorms.app', handler)
    cap.listener!({ url: `com.gorms.app://auth?code=${CODE}` })
    await Promise.resolve()
    expect(handler).toHaveBeenCalledTimes(1)
  })
  it('never logs the code, even when the handler fails', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {}); const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    cap.launchUrl = { url: `com.gorms.app://auth?code=${'S'.repeat(43)}` }
    await listenForAuthDeepLinks('com.gorms.app', async () => { throw new Error('boom') })
    expect(JSON.stringify([...log.mock.calls, ...err.mock.calls])).not.toContain('S'.repeat(43))
  })
})

describe('createSecureTokenStore', () => {
  it('stores the refresh token in the platform secure store, not localStorage', async () => {
    const setItem = vi.fn(); vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem, removeItem: vi.fn() })
    const s = createSecureTokenStore('k')
    expect(await s.get()).toBeNull()
    await s.set('R1'); expect(cap.store.get('k')).toBe('R1'); expect(await s.get()).toBe('R1')
    await s.clear(); expect(await s.get()).toBeNull()
    expect(setItem).not.toHaveBeenCalled()
  })
  it('reads with date conversion off, so an opaque token is always returned verbatim as a string', async () => {
    cap.store.set('k', '2020-08-27T13:27:07Z')
    await createSecureTokenStore('k').get()
    expect(cap.getArgs[0]).toEqual(['k', false])
  })
  it('re-checks the capability gate on every call: when it reports secure storage unavailable, nothing is read or written', async () => {
    cap.secureAvailable = false
    cap.store.set('k', 'R1')
    const s = createSecureTokenStore('k')
    expect(await s.get()).toBeNull()
    await expect(s.set('R2')).rejects.toMatchObject({ name: 'ShellUpdateRequiredError' })
    await s.clear()
    expect(cap.store.get('k')).toBe('R1')
    expect(cap.getArgs).toEqual([])
  })
  it('fails closed: a throwing plugin makes set reject (so sign-in fails) and get read as signed out', async () => {
    cap.storageFault = true
    const s = createSecureTokenStore('k')
    expect(await s.get()).toBeNull()
    await expect(s.set('R1')).rejects.toBeInstanceOf(Error)
  })
})
