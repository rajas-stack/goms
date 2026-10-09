import { beforeEach, describe, expect, it, vi } from 'vitest'

// I7 (final review): on a native COLD start the first render's queries must wait for the launch-link redeem, so trackHandoff is registered
// synchronously and covers listener registration + launch-URL lookup + redeem.
// I8: Capacitor never clears the launch URL, so every WebView reload re-delivers the (spent) launch link; its failure must not prompt a user
// whose session was restored. Real native.ts + bootstrap.ts + authPrompt + session; only the Capacitor plugins are faked.
const { cap } = vi.hoisted(() => ({
  cap: { listener: null as null | ((e: { url: string }) => void), launchUrl: null as null | { url: string }, gate: null as null | Promise<void> },
}))
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn(), close: vi.fn(async () => {}) } }))
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_e: string, cb: (e: { url: string }) => void) => { cap.listener = cb; return { remove: async () => {} } },
    getLaunchUrl: async () => { await cap.gate; return cap.launchUrl },
  },
}))
vi.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }))
vi.mock('@/lib/nativeShell', () => ({ hasCapability: () => true }))
import { createSession } from './session'

const SCHEME = 'com.gorms.app'
const CODE = 'R'.repeat(43)
const link = (q: string) => `${SCHEME}://auth?${q}`

async function setup(over: Record<string, unknown> = {}) {
  vi.resetModules()
  const prompt = await import('@/lib/authPrompt')
  const { bootstrapNativeAuth } = await import('./bootstrap')
  const session = { redeem: vi.fn(async () => {}), init: vi.fn(async () => {}), trackHandoff: vi.fn(), isSignedIn: vi.fn(() => false), ...over }
  return { prompt, bootstrapNativeAuth, session }
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwtFor = (nowMs: number) => `${b64({ alg: 'HS256' })}.${b64({ email: 'a@amnex.com', exp: Math.floor(nowMs / 1000) + 900 })}.sig`
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const memoryStore = (initial: string | null = null) => {
  const s = { value: initial, get: async () => s.value, set: async (t: string) => { s.value = t }, clear: async () => { s.value = null } }
  return s
}
const realSession = (fetchFn: unknown, store = memoryStore(null)) =>
  createSession({ apiBase: 'https://api.test', fetchFn: fetchFn as typeof fetch, store, locks: null, now: () => Date.now() })

beforeEach(() => { cap.listener = null; cap.launchUrl = null; cap.gate = null })

describe('I7: trackHandoff is registered synchronously and covers listener registration, the launch-URL lookup and the redeem', () => {
  it('trackHandoff is called before bootstrapNativeAuth awaits anything, and init() waits for the tracked promise', async () => {
    const gate = deferred<void>(); cap.gate = gate.promise
    const { bootstrapNativeAuth, session } = await setup()
    const boot = bootstrapNativeAuth(session, SCHEME)
    expect(session.trackHandoff).toHaveBeenCalledTimes(1)               // synchronously, i.e. before the dynamic import has even resolved
    expect(session.trackHandoff.mock.calls[0][0]).toBeInstanceOf(Promise)
    await flush()
    expect(session.init).not.toHaveBeenCalled()                          // parked behind getLaunchUrl
    gate.resolve()
    await boot
    expect(session.init).toHaveBeenCalledTimes(1)
  })
  it('a first-render token read issued at startup waits for the launch-link redeem: the exchange goes out first (no refresh with a missing token) and the token is returned', async () => {
    const gate = deferred<void>(); cap.gate = gate.promise
    cap.launchUrl = { url: link(`code=${CODE}`) }
    const { bootstrapNativeAuth } = await setup()
    const access = jwtFor(Date.now())
    const fetchFn = vi.fn(async (url: string) => (url.endsWith('/api/oauth/exchange') ? reply(200, { accessToken: access, refreshToken: 'R1', expiresIn: 900 }) : reply(500)))
    const store = memoryStore(null)
    const session = realSession(fetchFn, store)
    const boot = bootstrapNativeAuth(session, SCHEME)
    let settled = false
    const firstQuery = session.getAccessToken().then((t) => { settled = true; return t })   // what the first render's query does
    await flush()
    expect(settled).toBe(false)                                          // parked, even though the launch URL has not been read yet
    gate.resolve()
    await boot
    await expect(firstQuery).resolves.toBe(access)
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.test/api/oauth/exchange')   // the very first request: the exchange, never a refresh with a missing token
    expect(store.value).toBe('R1')
  })
  it('a plugin fault while looking up the launch URL neither rejects bootstrap nor skips init(), and logs only a fixed string', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rejected = Promise.reject(new Error(`plugin down ${CODE}`)); rejected.catch(() => {})
    cap.gate = rejected
    cap.launchUrl = { url: link(`code=${CODE}`) }
    const { bootstrapNativeAuth, session } = await setup()
    await expect(bootstrapNativeAuth(session, SCHEME)).resolves.toBeUndefined()
    expect(session.init).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(err.mock.calls)).not.toContain(CODE)
    err.mockRestore()
  })
})

describe('I8: the launch link is re-delivered on every reload of the Activity', () => {
  it('a failed LAUNCH redeem raises no prompt when init() restored a session', async () => {
    cap.launchUrl = { url: link(`code=${CODE}`) }
    let signedIn = false
    const { prompt, bootstrapNativeAuth, session } = await setup({
      redeem: vi.fn(async () => { throw new Error('spent') }), init: vi.fn(async () => { signedIn = true }), isSignedIn: vi.fn(() => signedIn),
    })
    await bootstrapNativeAuth(session, SCHEME)
    const listener = vi.fn(); prompt.subscribeAuthRequired(listener); await flush()
    expect(session.redeem).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()                              // neither delivered now nor held as pending for a later mount
  })
  it('a failed LAUNCH redeem still prompts when init() leaves the user signed out - and only AFTER init() ran', async () => {
    cap.launchUrl = { url: link(`code=${CODE}`) }
    const order: string[] = []
    const { prompt, bootstrapNativeAuth, session } = await setup({ redeem: vi.fn(async () => { throw new Error('bad') }), init: vi.fn(async () => { order.push('init') }) })
    const listener = vi.fn(() => order.push('prompt')); prompt.subscribeAuthRequired(listener)
    await bootstrapNativeAuth(session, SCHEME); await flush()
    expect(listener).toHaveBeenCalledWith('unauthorized')
    expect(order).toEqual(['init', 'prompt'])
  })
  it('a LAUNCH ?error link follows the same rule (it is re-delivered on reload too): no prompt with a restored session, a prompt without one', async () => {
    cap.launchUrl = { url: link('error=domain') }
    const a = await setup({ isSignedIn: vi.fn(() => true) })
    const listenerA = vi.fn(); a.prompt.subscribeAuthRequired(listenerA)
    await a.bootstrapNativeAuth(a.session, SCHEME); await flush()
    expect(listenerA).not.toHaveBeenCalled()
    const b = await setup({ isSignedIn: vi.fn(() => false) })
    const listenerB = vi.fn(); b.prompt.subscribeAuthRequired(listenerB)
    await b.bootstrapNativeAuth(b.session, SCHEME); await flush()
    expect(listenerB).toHaveBeenCalledWith('forbidden')
  })
  it('a failed WARM redeem or warm ?error link ALWAYS prompts, even while signed in', async () => {
    const { prompt, bootstrapNativeAuth, session } = await setup({ redeem: vi.fn(async () => { throw new Error('bad') }), isSignedIn: vi.fn(() => true) })
    await bootstrapNativeAuth(session, SCHEME)
    const listener = vi.fn(); prompt.subscribeAuthRequired(listener)
    cap.listener!({ url: link(`code=${CODE}`) })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith('unauthorized'))
    cap.listener!({ url: link('error=domain') })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith('forbidden'))
  })
  it('end to end with a real session: a reload re-delivers the spent code - exchange 401, stored session restored, NO prompt', async () => {
    cap.launchUrl = { url: link(`code=${CODE}`) }
    const { prompt, bootstrapNativeAuth } = await setup()
    const access = jwtFor(Date.now())
    const fetchFn = vi.fn(async (url: string) => (url.endsWith('/api/oauth/exchange') ? reply(401) : reply(200, { accessToken: access, refreshToken: 'R2', expiresIn: 900 })))
    const session = realSession(fetchFn, memoryStore('R1'))
    const listener = vi.fn(); prompt.subscribeAuthRequired(listener)
    await bootstrapNativeAuth(session, SCHEME); await flush()
    expect(session.isSignedIn()).toBe(true)
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual(['https://api.test/api/oauth/exchange', 'https://api.test/api/oauth/refresh'])
    expect(listener).not.toHaveBeenCalled()
  })
  it('end to end with a real session: a signed-out user whose launch code fails still gets the prompt', async () => {
    cap.launchUrl = { url: link(`code=${CODE}`) }
    const { prompt, bootstrapNativeAuth } = await setup()
    const session = realSession(vi.fn(async () => reply(401)), memoryStore(null))
    const listener = vi.fn(); prompt.subscribeAuthRequired(listener)
    await bootstrapNativeAuth(session, SCHEME); await flush()
    expect(session.isSignedIn()).toBe(false)
    expect(listener).toHaveBeenCalledWith('unauthorized')
  })
})
