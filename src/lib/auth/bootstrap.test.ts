import { beforeEach, describe, expect, it, vi } from 'vitest'
const { prompt } = vi.hoisted(() => ({ prompt: { pending: vi.fn(), raise: vi.fn() } }))
vi.mock('@/lib/authPrompt', () => ({ setPendingAuthReason: prompt.pending, raiseAuthReason: prompt.raise }))
import { bootstrapAuth, takeAuthParams } from './bootstrap'
import { createSession } from './session'

const hist = () => ({ state: { s: 1 }, replaceState: vi.fn() })
beforeEach(() => { prompt.pending.mockReset(); prompt.raise.mockReset() })

describe('takeAuthParams', () => {
  it('extracts auth_code and removes it from the address bar, keeping the rest of the URL', () => {
    const h = hist()
    expect(takeAuthParams('https://goms.test/bid-tracker?sheet=x&auth_code=ABC#top', h)).toEqual({ code: 'ABC', error: undefined })
    expect(h.replaceState).toHaveBeenCalledWith({ s: 1 }, '', '/bid-tracker?sheet=x#top')
  })
  it('extracts auth_error and strips it the same way', () => {
    const h = hist()
    expect(takeAuthParams('https://goms.test/?auth_error=domain', h)).toEqual({ code: undefined, error: 'domain' })
    expect(h.replaceState).toHaveBeenCalledWith({ s: 1 }, '', '/')
  })
  it('touches nothing when neither parameter is present', () => {
    const h = hist()
    expect(takeAuthParams('https://goms.test/a?b=1', h)).toEqual({ code: undefined, error: undefined })
    expect(h.replaceState).not.toHaveBeenCalled()
  })
  it('only ever rewrites to a same-origin relative URL, even when the href carries credentials, a port or another host', () => {
    const h = hist()
    takeAuthParams('https://user:pw@evil.test:8443/x/y?auth_code=ABC&k=v', h)
    const target = h.replaceState.mock.calls[0][2] as string
    expect(target).toBe('/x/y?k=v')
    expect(target.startsWith('/') && !target.startsWith('//')).toBe(true)
  })
  it('R18: a "//" pathname is collapsed to a single leading slash so the target can never resolve cross-origin', () => {
    const h = hist()
    expect(takeAuthParams('https://goms.test//evil.test/x?auth_code=ABC&k=v#top', h)).toEqual({ code: 'ABC', error: undefined })
    const target = h.replaceState.mock.calls[0][2] as string
    expect(target).toBe('/evil.test/x?k=v#top')
    expect(target.startsWith('/') && !target.startsWith('//')).toBe(true)
    const many = hist()
    takeAuthParams('https://goms.test////a?auth_error=google', many)
    expect(many.replaceState.mock.calls[0][2]).toBe('/a')
  })
  it('R18: a throwing replaceState never escapes - the code and error are still returned', () => {
    const h = { state: null, replaceState: vi.fn(() => { throw new Error('SecurityError') }) }
    expect(takeAuthParams('https://goms.test/?auth_code=ABC', h)).toEqual({ code: 'ABC', error: undefined })
    expect(takeAuthParams('https://goms.test/?auth_error=domain', h)).toEqual({ code: undefined, error: 'domain' })
  })
})

describe('bootstrapAuth', () => {
  const win = (href: string) => ({ location: { href }, history: hist() as unknown as History })
  const fakeSession = (over: Record<string, unknown> = {}) => ({
    redeem: vi.fn(async () => {}), init: vi.fn(async () => {}), trackHandoff: vi.fn(), ...over,
  })

  it('strips the code from the URL BEFORE any network call, then redeems it as a web code', async () => {
    const order: string[] = []
    const w = win('https://goms.test/?auth_code=ABC')
    ;(w.history.replaceState as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('replaceState'))
    const session = fakeSession({ redeem: vi.fn(async () => { order.push('redeem') }), init: vi.fn(async () => { order.push('init') }) })
    await bootstrapAuth(session, w)
    expect(order).toEqual(['replaceState', 'redeem'])
    expect(session.redeem).toHaveBeenCalledWith('ABC', 'web')
    expect(session.init).not.toHaveBeenCalled()
  })
  it('registers the redeem with trackHandoff (R15) so token reads wait for it', async () => {
    const session = fakeSession()
    await bootstrapAuth(session, win('https://goms.test/?auth_code=ABC'))
    expect(session.trackHandoff).toHaveBeenCalledTimes(1)
    expect(session.trackHandoff.mock.calls[0][0]).toBeInstanceOf(Promise)
  })
  it('without a code it restores the stored session and tracks no handoff', async () => {
    const session = fakeSession()
    await bootstrapAuth(session, win('https://goms.test/'))
    expect(session.init).toHaveBeenCalled(); expect(session.redeem).not.toHaveBeenCalled()
    expect(session.trackHandoff).not.toHaveBeenCalled()
    expect(prompt.pending).not.toHaveBeenCalled()
  })
  it('a rejected code does not break startup: it falls back to the stored session and asks the user to sign in', async () => {
    const session = fakeSession({ redeem: vi.fn(async () => { throw new Error('bad') }) })
    await expect(bootstrapAuth(session, win('https://goms.test/?auth_code=BAD'))).resolves.toBeUndefined()
    expect(session.init).toHaveBeenCalled()
    expect(prompt.pending).toHaveBeenCalledWith('unauthorized')
  })
  it('R18: a "//" pathname still redeems the code, with a single-slash replaceState target, and bootstrap resolves', async () => {
    const w = win('https://goms.test//evil.test/x?auth_code=ABC')
    const session = fakeSession()
    await expect(bootstrapAuth(session, w)).resolves.toBeUndefined()
    const target = (w.history.replaceState as ReturnType<typeof vi.fn>).mock.calls[0][2] as string
    expect(target.startsWith('/') && !target.startsWith('//')).toBe(true)
    expect(session.redeem).toHaveBeenCalledWith('ABC', 'web')
    expect(session.trackHandoff).toHaveBeenCalledTimes(1)
    expect(session.init).not.toHaveBeenCalled()
  })
  it('R18: a throwing replaceState does not reject bootstrap - the code is still redeemed', async () => {
    const w = win('https://goms.test/?auth_code=ABC')
    ;(w.history.replaceState as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('SecurityError') })
    const session = fakeSession()
    await expect(bootstrapAuth(session, w)).resolves.toBeUndefined()
    expect(session.redeem).toHaveBeenCalledWith('ABC', 'web')
    expect(session.trackHandoff).toHaveBeenCalledTimes(1)
    expect(session.init).not.toHaveBeenCalled()
    expect(prompt.pending).not.toHaveBeenCalled()
  })
  it('R18: a throwing replaceState with only auth_error still raises the prompt and runs init', async () => {
    const w = win('https://goms.test/?auth_error=domain')
    ;(w.history.replaceState as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('SecurityError') })
    const session = fakeSession()
    await expect(bootstrapAuth(session, w)).resolves.toBeUndefined()
    expect(prompt.pending).toHaveBeenCalledWith('forbidden')
    expect(session.init).toHaveBeenCalled()
  })
  it('a non-amnex sign-in (auth_error=domain|unverified) surfaces as "forbidden"; other and unknown errors as "unauthorized"', async () => {
    for (const [err, reason] of [['domain', 'forbidden'], ['unverified', 'forbidden'], ['state', 'unauthorized'], ['google', 'unauthorized'], ['denied', 'unauthorized'], ['something-new', 'unauthorized']] as const) {
      prompt.pending.mockReset()
      const w = win(`https://goms.test/p?auth_error=${err}`)
      await bootstrapAuth(fakeSession(), w)
      expect(prompt.pending, err).toHaveBeenCalledTimes(1)
      expect(prompt.pending, err).toHaveBeenCalledWith(reason)
      expect(w.history.replaceState).toHaveBeenCalledWith({ s: 1 }, '', '/p')
    }
  })

  it('R15 integration: a token read issued while the redeem is in flight waits for it and gets the redeemed token (no 401, no extra refresh)', async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const access = `${b64({ alg: 'HS256' })}.${b64({ email: 'a@amnex.com', exp: Math.floor(Date.now() / 1000) + 900 })}.sig`
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const fetchFn = vi.fn(async () => {
      await gate
      return new Response(JSON.stringify({ accessToken: access, refreshToken: 'R1', expiresIn: 900 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    let stored: string | null = null
    const session = createSession({
      apiBase: 'https://api.test', fetchFn: fetchFn as unknown as typeof fetch, locks: null, now: () => Date.now(),
      store: { get: async () => stored, set: async (t: string) => { stored = t }, clear: async () => { stored = null } },
    })
    const boot = bootstrapAuth(session, win('https://goms.test/?auth_code=ABC'))
    let settled = false
    const tokenRead = session.getAccessToken().then((t) => { settled = true; return t })
    await new Promise((r) => setTimeout(r, 0))
    expect(settled).toBe(false) // the query is parked behind the redeem
    release()
    await boot
    await expect(tokenRead).resolves.toBe(access)
    expect(fetchFn).toHaveBeenCalledTimes(1) // only the exchange; no refresh with a missing token
    expect(stored).toBe('R1')
    expect(prompt.pending).not.toHaveBeenCalled()
  })
})

describe('bootstrapNativeAuth', () => {
  beforeEach(() => { vi.resetModules() })
  it("registers the deep-link listener for THIS flavor's scheme BEFORE restoring the stored session, and redeems an app code", async () => {
    const order: string[] = []
    const listen = vi.fn(async (_scheme: string, handler: (r: { code?: string; error?: string }) => Promise<void>) => { order.push('listen'); await handler({ code: 'C'.repeat(43) }) })
    vi.doMock('./native', () => ({ listenForAuthDeepLinks: listen }))
    const { bootstrapNativeAuth } = await import('./bootstrap')
    const session = { redeem: vi.fn(async () => { order.push('redeem') }), init: vi.fn(async () => { order.push('init') }), trackHandoff: vi.fn(), isSignedIn: vi.fn(() => false) }
    await bootstrapNativeAuth(session, 'com.gorms.app.dev')
    expect(listen).toHaveBeenCalledWith('com.gorms.app.dev', expect.any(Function), expect.any(Function)) // warm + launch handlers
    expect(session.redeem).toHaveBeenCalledWith('C'.repeat(43), 'app')
    expect(order).toEqual(['listen', 'redeem', 'init'])
  })
  it('an error deep link becomes a sign-in prompt: domain/unverified -> forbidden, others -> unauthorized', async () => {
    let handler!: (r: { code?: string; error?: string }) => Promise<void>
    vi.doMock('./native', () => ({ listenForAuthDeepLinks: async (_s: string, h: typeof handler) => { handler = h } }))
    const { bootstrapNativeAuth } = await import('./bootstrap')
    await bootstrapNativeAuth({ redeem: vi.fn(), init: vi.fn(async () => {}), trackHandoff: vi.fn(), isSignedIn: vi.fn(() => false) }, 'com.gorms.app')
    await handler({ error: 'domain' }); expect(prompt.raise).toHaveBeenLastCalledWith('forbidden')
    await handler({ error: 'google' }); expect(prompt.raise).toHaveBeenLastCalledWith('unauthorized')
    expect(prompt.pending).not.toHaveBeenCalled() // raiseAuthReason decides between "deliver now" and "pending"; the caller never picks
  })
})
