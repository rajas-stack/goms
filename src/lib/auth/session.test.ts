// src/lib/auth/session.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalStorageStore } from './stores'
import { createSession, type LockManagerLike, type TokenStore } from './session'

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (email: string, expSec: number) => `${b64({ alg: 'HS256' })}.${b64({ email, exp: expSec })}.sig`
const memoryStore = (initial: string | null = null): TokenStore & { value: string | null } => {
  const s = { value: initial, get: async () => s.value, set: async (t: string) => { s.value = t }, clear: async () => { s.value = null } }
  return s
}
/** First recorded fetch call as [url, init] (the vi.fn mocks here are typed loosely). */
const callArgs = (f: unknown) => (f as { mock: { calls: unknown[][] } }).mock.calls[0] as [string, RequestInit]
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup(opts: { store?: ReturnType<typeof memoryStore>; locks?: LockManagerLike | null; fetchFn?: typeof fetch; nowMs?: number } = {}) {
  const store = opts.store ?? memoryStore('R1')
  const clock = { t: opts.nowMs ?? 1_000_000 }
  const fetchFn = opts.fetchFn ?? vi.fn(async () => json(500))
  const session = createSession({ apiBase: 'https://api.test', fetchFn: fetchFn as typeof fetch, store, locks: opts.locks ?? null, now: () => clock.t })
  return { store, clock, fetchFn: fetchFn as ReturnType<typeof vi.fn>, session }
}
const fresh = (email = 'a@amnex.com', ms = 1_000_000) => jwt(email, Math.floor(ms / 1000) + 900)

describe('init / getAccessToken', () => {
  it('with a stored refresh token it refreshes once at startup and reports the signed-in user', async () => {
    const f = vi.fn(async () => json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 }))
    const { session, store } = setup({ fetchFn: f as unknown as typeof fetch })
    const seen: unknown[] = []
    session.subscribe((u, l) => seen.push([u, l]))
    await session.init()
    expect(store.value).toBe('R2')
    expect(seen[seen.length - 1]).toEqual([{ email: 'a@amnex.com' }, false])
    expect(JSON.parse(callArgs(f)[1].body as string)).toEqual({ refreshToken: 'R1' })
  })
  it('with nothing stored it is signed out and does not call the network', async () => {
    const { session, fetchFn } = setup({ store: memoryStore(null) })
    await session.init()
    expect(await session.getAccessToken()).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })
  it('serves the in-memory access token until 60 s before expiry, then refreshes', async () => {
    let n = 0
    const f = vi.fn(async () => json(200, { accessToken: fresh(`u${++n}@amnex.com`), refreshToken: `R${n + 1}`, expiresIn: 900 }))
    const { session, clock } = setup({ fetchFn: f as unknown as typeof fetch })
    await session.init()
    expect(f).toHaveBeenCalledTimes(1)
    clock.t += 800_000
    await session.getAccessToken(); expect(f).toHaveBeenCalledTimes(1)          // 100 s left: still served
    clock.t += 45_000
    await session.getAccessToken(); expect(f).toHaveBeenCalledTimes(2)          // 55 s left: refreshed
  })
})

describe('single-flight and cross-tab lock', () => {
  it('a batch of simultaneous callers causes ONE refresh request', async () => {
    let resolve!: (r: Response) => void
    const f = vi.fn(() => new Promise<Response>((r) => { resolve = r }))
    const { session } = setup({ fetchFn: f as unknown as typeof fetch })
    const calls = [session.forceRefresh(), session.forceRefresh(), session.forceRefresh()]
    await Promise.resolve()
    resolve(json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 }))
    const tokens = await Promise.all(calls)
    expect(f).toHaveBeenCalledTimes(1)
    expect(new Set(tokens).size).toBe(1)
  })
  it('takes the navigator.locks lock named goms-auth-refresh and re-reads the stored token INSIDE it', async () => {
    const order: string[] = []
    const locks: LockManagerLike = { request: async (name, cb) => { order.push(`lock:${name}`); return cb() } }
    const store = memoryStore('R1')
    const f = vi.fn(async (_u: unknown, init: RequestInit) => { order.push(`post:${JSON.parse(init.body as string).refreshToken}`); return json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 }) })
    const { session } = setup({ store, locks, fetchFn: f as unknown as typeof fetch })
    // another tab rotated the token while this one waited for the lock
    const realGet = store.get; store.get = async () => { order.push('read'); return realGet() }
    await session.forceRefresh()
    expect(order).toEqual(['lock:goms-auth-refresh', 'read', 'post:R1'])
  })
  it('two "tabs" sharing one store and a real mutual-exclusion lock rotate sequentially: the second uses the first one\'s new token, so nothing is reused', async () => {
    const store = memoryStore('R1')
    let chain: Promise<unknown> = Promise.resolve()
    const mutex: LockManagerLike = { request: (_n, cb) => { const r = chain.then(cb); chain = r.catch(() => {}); return r as Promise<never> } }
    let gen = 1
    const valid = new Set(['R1'])
    const server = vi.fn(async (_u: unknown, init: RequestInit) => {
      const sent = JSON.parse(init.body as string).refreshToken as string
      if (!valid.has(sent)) return json(401)
      valid.delete(sent); const next = `R${++gen}`; valid.add(next)
      return json(200, { accessToken: fresh(), refreshToken: next, expiresIn: 900 })
    })
    const a = setup({ store, locks: mutex, fetchFn: server as unknown as typeof fetch }).session
    const b = setup({ store, locks: mutex, fetchFn: server as unknown as typeof fetch }).session
    const [ta, tb] = await Promise.all([a.forceRefresh(), b.forceRefresh()])
    expect(ta).toBeTruthy(); expect(tb).toBeTruthy()
    expect(store.value).toBe('R3')
    expect(server).toHaveBeenCalledTimes(2)
  })
  it('works without navigator.locks (single-flight only)', async () => {
    const { session } = setup({ locks: null, fetchFn: vi.fn(async () => json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 })) as unknown as typeof fetch })
    await expect(session.forceRefresh()).resolves.toBeTruthy()
  })
})

describe('failure handling', () => {
  it('a 401 from the server means the session is gone: the stored token is cleared and the user is signed out', async () => {
    const { session, store } = setup({ fetchFn: vi.fn(async () => json(401, { error: 'session_expired' })) as unknown as typeof fetch })
    const seen: unknown[] = []
    session.subscribe((u) => seen.push(u))
    await session.init()
    expect(store.value).toBeNull()
    expect(seen[seen.length - 1]).toBeNull()
  })
  it('a NETWORK failure or a 5xx must NOT wipe the stored refresh token (offline is not revoked)', async () => {
    for (const f of [vi.fn(async () => { throw new TypeError('offline') }), vi.fn(async () => json(503))]) {
      const { session, store } = setup({ fetchFn: f as unknown as typeof fetch })
      await expect(session.forceRefresh()).resolves.toBeNull()
      expect(store.value).toBe('R1')
    }
  })
  it('a failed refresh does not poison later ones (the in-flight slot is released)', async () => {
    let n = 0
    const f = vi.fn(async () => (++n === 1 ? json(503) : json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 })))
    const { session } = setup({ fetchFn: f as unknown as typeof fetch })
    expect(await session.forceRefresh()).toBeNull()
    expect(await session.forceRefresh()).toBeTruthy()
  })
})

describe('redeem (web handoff / app deep link) and sign-out', () => {
  it('exchanges the one-time code with the client kind, stores only the refresh token, and signs the user in', async () => {
    const f = vi.fn(async () => json(200, { accessToken: fresh('z@amnex.com'), refreshToken: 'RX', expiresIn: 900 }))
    const { session, store } = setup({ store: memoryStore(null), fetchFn: f as unknown as typeof fetch })
    await session.redeem('CODE', 'web')
    expect(callArgs(f)[0]).toBe('https://api.test/api/oauth/exchange')
    expect(JSON.parse(callArgs(f)[1].body as string)).toEqual({ code: 'CODE', client: 'web' })
    expect(store.value).toBe('RX')
    expect(await session.getAccessToken()).toBeTruthy()
  })
  it('a rejected code throws and leaves the user signed out', async () => {
    const { session, store } = setup({ store: memoryStore(null), fetchFn: vi.fn(async () => json(401)) as unknown as typeof fetch })
    await expect(session.redeem('BAD', 'web')).rejects.toThrow()
    expect(store.value).toBeNull()
  })
  it('signOut clears local state first, then tells the server (best effort)', async () => {
    const f = vi.fn(async () => json(204))
    const { session, store } = setup({ fetchFn: f as unknown as typeof fetch })
    await session.signOut()
    expect(store.value).toBeNull()
    expect(callArgs(f)[0]).toBe('https://api.test/api/oauth/logout')
    const failing = setup({ fetchFn: vi.fn(async () => { throw new Error('down') }) as unknown as typeof fetch })
    await expect(failing.session.signOut()).resolves.toBeUndefined()
    expect(failing.store.value).toBeNull()
  })
})

describe('localStorage store', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('round-trips under one key and clears', async () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) })
    const s = createLocalStorageStore('k')
    expect(await s.get()).toBeNull()
    await s.set('T'); expect(await s.get()).toBe('T')
    await s.clear(); expect(await s.get()).toBeNull()
  })
  it('never throws when storage is blocked', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } })
    const s = createLocalStorageStore('k')
    expect(await s.get()).toBeNull()
    await expect(s.set('T')).resolves.toBeUndefined()
  })
})

describe('R7: only an explicit 401 from the refresh endpoint clears the stored token', () => {
  it('a 400 or a 5xx leaves the stored token and the session untouched', async () => {
    for (const status of [400, 500, 502, 503]) {
      const { session, store } = setup({ fetchFn: vi.fn(async () => json(status)) as unknown as typeof fetch })
      const seen: unknown[] = []
      session.subscribe((u) => seen.push(u))
      await session.init()
      expect(store.value).toBe('R1')
      expect(seen[seen.length - 1]).toBeNull()
    }
  })
  it('a network error leaves the token, and a later refresh recovers the session', async () => {
    let n = 0
    const f = vi.fn(async () => {
      if (++n === 1) throw new TypeError('offline')
      return json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 })
    })
    const { session, store } = setup({ fetchFn: f as unknown as typeof fetch })
    await session.init()
    expect(store.value).toBe('R1')
    expect(JSON.parse(callArgs(f)[1].body as string)).toEqual({ refreshToken: 'R1' })
    expect(await session.getAccessToken()).toBeTruthy()   // back online: recovers
    expect(store.value).toBe('R2')
  })
  it('a timeout (aborted fetch) behaves like a network error', async () => {
    const f = vi.fn(async () => { throw new DOMException('timed out', 'AbortError') })
    const { session, store } = setup({ fetchFn: f as unknown as typeof fetch })
    await expect(session.forceRefresh()).resolves.toBeNull()
    expect(store.value).toBe('R1')
  })
})

describe('R15: trackHandoff (web handoff redeem in flight)', () => {
  it('getAccessToken waits for an in-flight handoff to settle before returning', async () => {
    let finish!: () => void
    const { session } = setup({ store: memoryStore(null) })
    const handoff = new Promise<void>((r) => { finish = r })
    session.trackHandoff(handoff)
    let resolved = false
    const p = session.getAccessToken().then((t) => { resolved = true; return t })
    await new Promise((r) => setTimeout(r, 0))
    expect(resolved).toBe(false)
    finish()
    await p
    expect(resolved).toBe(true)
  })
  it('the handoff\'s own result is what getAccessToken then returns', async () => {
    const f = vi.fn(async () => json(200, { accessToken: fresh('h@amnex.com'), refreshToken: 'RH', expiresIn: 900 }))
    const { session, store } = setup({ store: memoryStore(null), fetchFn: f as unknown as typeof fetch })
    session.trackHandoff(session.redeem('CODE', 'web'))
    const token = await session.getAccessToken()
    expect(token).toBeTruthy()
    expect(store.value).toBe('RH')
    expect(f).toHaveBeenCalledTimes(1)   // no extra refresh
  })
  it('a rejected handoff does not make getAccessToken throw', async () => {
    const { session } = setup({ store: memoryStore(null) })
    const handoff = Promise.reject(new Error('bad code'))
    session.trackHandoff(handoff)
    await expect(session.getAccessToken()).resolves.toBeNull()
    await expect(handoff).rejects.toThrow('bad code')   // the caller still sees its own rejection
  })
  it('the slot is released once settled (a later getAccessToken is not blocked)', async () => {
    const { session } = setup({ store: memoryStore(null) })
    session.trackHandoff(Promise.resolve())
    await session.getAccessToken()
    await expect(session.getAccessToken()).resolves.toBeNull()
  })
})

/** A promise whose resolution the test controls. */
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
const mutexLocks = (): LockManagerLike => { let chain: Promise<unknown> = Promise.resolve(); return { request: (_n, cb) => { const r = chain.then(cb); chain = r.catch(() => {}); return r as Promise<never> } } }
const okBody = (access: string, refreshToken: string) => json(200, { accessToken: access, refreshToken, expiresIn: 900 })

describe('R17-1: a stale 401 cannot wipe a token that replaced the one it was sent with', () => {
  it('init() refreshing an expired token while redeem() signs in: the late 401 leaves the redeemed token and the signed-in user', async () => {
    const refreshStarted = deferred<void>()
    const refreshRes = deferred<Response>()
    const f = vi.fn((url: string) => {
      if (url.endsWith('/api/oauth/refresh')) { refreshStarted.resolve(); return refreshRes.promise }
      return Promise.resolve(okBody(fresh('z@amnex.com'), 'RX'))
    })
    const { session, store } = setup({ store: memoryStore('R_old'), fetchFn: f as unknown as typeof fetch })
    const seen: unknown[] = []
    session.subscribe((u) => seen.push(u))
    const init = session.init()
    await refreshStarted.promise
    await session.redeem('CODE', 'web')
    expect(store.value).toBe('RX')
    refreshRes.resolve(json(401))
    await init
    expect(store.value).toBe('RX')
    expect(seen[seen.length - 1]).toEqual({ email: 'z@amnex.com' })
    expect(await session.getAccessToken()).toBeTruthy()
  })
  it('a 401 for a token another tab has already replaced in the store does not clear the newer one', async () => {
    const started = deferred<void>()
    const res = deferred<Response>()
    const f = vi.fn(() => { started.resolve(); return res.promise })
    const { session, store } = setup({ fetchFn: f as unknown as typeof fetch })
    const p = session.forceRefresh()
    await started.promise
    store.value = 'R_other_tab'
    res.resolve(json(401))
    await expect(p).resolves.toBeNull()
    expect(store.value).toBe('R_other_tab')
  })
  it('a 401 for the CURRENT stored token still clears it and signs out (R7 preserved)', async () => {
    const { session, store } = setup({ fetchFn: vi.fn(async () => json(401)) as unknown as typeof fetch })
    const seen: unknown[] = []
    session.subscribe((u) => seen.push(u))
    await expect(session.forceRefresh()).resolves.toBeNull()
    expect(store.value).toBeNull()
    expect(seen[seen.length - 1]).toBeNull()
  })
})

describe('R17-2: sign-out cannot be undone by a refresh already in flight', () => {
  it('same tab: the refresh that lands after signOut persists nothing and sets no access; the old token is revoked', async () => {
    const started = deferred<void>()
    const refreshRes = deferred<Response>()
    const f = vi.fn((url: string) => {
      if (url.endsWith('/api/oauth/refresh')) { started.resolve(); return refreshRes.promise }
      return Promise.resolve(json(204))
    })
    const store = memoryStore('R1')
    const setSpy = vi.spyOn(store, 'set')
    const { session } = setup({ store, fetchFn: f as unknown as typeof fetch })
    const seen: unknown[] = []
    session.subscribe((u) => seen.push(u))
    const refresh = session.forceRefresh()
    await started.promise
    const out = session.signOut()
    refreshRes.resolve(okBody(fresh(), 'R2'))
    await out
    await refresh
    expect(setSpy).not.toHaveBeenCalled()
    expect(store.value).toBeNull()
    expect(seen[seen.length - 1]).toBeNull()
    expect(await session.getAccessToken()).toBeNull()
    const logout = f.mock.calls.filter((c) => c[0].endsWith('/api/oauth/logout'))
    expect(logout).toHaveLength(1)
  })
  it("across tabs (shared store + lock): signOut waits for the other tab's rotation and revokes the freshest token", async () => {
    const store = memoryStore('R1')
    const locks = mutexLocks()
    const started = deferred<void>()
    const refreshRes = deferred<Response>()
    const fB = vi.fn(() => { started.resolve(); return refreshRes.promise })
    const fA = vi.fn(async () => json(204))
    const a = setup({ store, locks, fetchFn: fA as unknown as typeof fetch }).session
    const b = setup({ store, locks, fetchFn: fB as unknown as typeof fetch }).session
    const refresh = b.forceRefresh()
    await started.promise
    const out = a.signOut()
    refreshRes.resolve(okBody(fresh(), 'R2'))
    await Promise.all([out, refresh])
    expect(store.value).toBeNull()
    expect(fA).toHaveBeenCalledTimes(1)
    expect(JSON.parse(callArgs(fA)[1].body as string)).toEqual({ refreshToken: 'R2' })
  })
  it('signOut resolves, with local state cleared, when the logout request rejects', async () => {
    const started = deferred<void>()
    const refreshRes = deferred<Response>()
    const f = vi.fn((url: string) => {
      if (url.endsWith('/api/oauth/refresh')) { started.resolve(); return refreshRes.promise }
      return Promise.reject(new TypeError('offline'))
    })
    const { session, store } = setup({ fetchFn: f as unknown as typeof fetch })
    const refresh = session.forceRefresh()
    await started.promise
    const out = session.signOut()
    refreshRes.resolve(okBody(fresh(), 'R2'))
    await expect(out).resolves.toBeUndefined()
    await refresh
    expect(store.value).toBeNull()
  })
})

describe('R17-3: a bad response or storage/lock fault is transient, never a wedged session', () => {
  type Scenario = { name: string; fault: 'json' | 'decode' | 'store' | 'lock'; expectStored: string }
  const scenarios: Scenario[] = [
    { name: 'a 200 that is not JSON', fault: 'json', expectStored: 'R1' },
    // the server already rotated: the new refresh token is persisted before the access token is decoded, so it (not the dead R1) stays stored
    { name: 'an undecodable access token', fault: 'decode', expectStored: 'RB' },
    { name: 'store.set rejecting', fault: 'store', expectStored: 'R1' },
    { name: 'locks.request throwing', fault: 'lock', expectStored: 'R1' },
  ]
  it.each(scenarios)('$name: keeps the token, getAccessToken() resolves null, init is not rejected, and a later call recovers', async (sc) => {
    const store = memoryStore('R1')
    const flags = { bad: true }
    if (sc.fault === 'store') { const real = store.set; store.set = async (t: string) => { if (flags.bad) throw new Error('quota'); return real(t) } }
    const locks: LockManagerLike | null = sc.fault === 'lock' ? { request: (_n, cb) => { if (flags.bad) throw new Error('locks unavailable'); return cb() } } : null
    const f = vi.fn(async () => {
      if (!flags.bad) return okBody(fresh(), 'R9')
      if (sc.fault === 'json') return new Response('<html>oops</html>', { status: 200 })
      if (sc.fault === 'decode') return okBody('not-a-jwt', 'RB')
      return okBody(fresh(), 'RS')
    })
    const { session } = setup({ store, locks, fetchFn: f as unknown as typeof fetch })
    const seen: unknown[] = []
    session.subscribe((u) => seen.push(u))
    await expect(session.init()).resolves.toBeUndefined()
    await expect(session.getAccessToken()).resolves.toBeNull()
    expect(store.value).toBe(sc.expectStored)
    expect(seen.every((u) => u === null)).toBe(true)
    flags.bad = false
    await expect(session.getAccessToken()).resolves.toBeTruthy()
    expect(store.value).toBe('R9')
  })
})

describe('I11: expiry is measured on the DEVICE clock from the moment of receipt (expiresIn), never from the JWT exp', () => {
  // A device whose clock is 20 minutes FAST: the JWT's exp (server time + 15 min) is already in the past by the device clock.
  const SKEW_MS = 20 * 60_000
  const serverNow = 1_000_000
  it('a skewed-fast clock does not refresh on every read: the token is served until 60 s before receipt + expiresIn', async () => {
    const f = vi.fn(async () => json(200, { accessToken: jwt('a@amnex.com', Math.floor(serverNow / 1000) + 900), refreshToken: 'R2', expiresIn: 900 }))
    const { session, clock } = setup({ nowMs: serverNow + SKEW_MS, fetchFn: f as unknown as typeof fetch })
    await session.init()
    expect(f).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 5; i++) await session.getAccessToken()
    expect(f).toHaveBeenCalledTimes(1)                           // old behaviour (exp vs device clock): a refresh on EVERY call
    clock.t += 800_000
    await session.getAccessToken(); expect(f).toHaveBeenCalledTimes(1)   // 100 s left
    clock.t += 45_000
    await session.getAccessToken(); expect(f).toHaveBeenCalledTimes(2)   // 55 s left: refreshed
  })
  it('a skewed-SLOW clock does not serve an expired token: the lifetime is still receipt + expiresIn', async () => {
    const f = vi.fn(async () => json(200, { accessToken: jwt('a@amnex.com', Math.floor(serverNow / 1000) + 900), refreshToken: 'R2', expiresIn: 900 }))
    const { session, clock } = setup({ nowMs: serverNow - SKEW_MS, fetchFn: f as unknown as typeof fetch })
    await session.init()
    clock.t += 860_000
    await session.getAccessToken(); expect(f).toHaveBeenCalledTimes(2)   // 40 s left by receipt + expiresIn, although exp says "20 min left"
  })
  it('redeem uses expiresIn too', async () => {
    const f = vi.fn(async () => json(200, { accessToken: jwt('a@amnex.com', Math.floor(serverNow / 1000) + 900), refreshToken: 'RX', expiresIn: 900 }))
    const { session } = setup({ store: memoryStore(null), nowMs: serverNow + SKEW_MS, fetchFn: f as unknown as typeof fetch })
    await session.redeem('CODE', 'web')
    await session.getAccessToken(); await session.getAccessToken()
    expect(f).toHaveBeenCalledTimes(1)                           // only the exchange
  })
  it('without a usable expiresIn (absent, 0, negative, NaN, a string) it falls back to the JWT exp', async () => {
    for (const expiresIn of [undefined, 0, -5, Number.NaN, '900']) {
      const f = vi.fn(async () => json(200, { accessToken: fresh(), refreshToken: 'R2', ...(expiresIn === undefined ? {} : { expiresIn }) }))
      const { session, clock } = setup({ fetchFn: f as unknown as typeof fetch })
      await session.init()
      await session.getAccessToken(); expect(f, String(expiresIn)).toHaveBeenCalledTimes(1)   // fresh(): exp = now + 900 s
      clock.t += 845_000
      await session.getAccessToken(); expect(f, String(expiresIn)).toHaveBeenCalledTimes(2)
    }
  })
})

describe('T10: listener isolation, a stale local token is never kept after a failed write, a still-valid token survives a transient refresh failure', () => {
  it('a throwing subscriber cannot skip store.clear() in signOut, and never leaks its message to the console', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { session, store } = setup({ fetchFn: vi.fn(async () => json(204)) as unknown as typeof fetch })
    let armed = false
    session.subscribe(() => { if (armed) throw new Error('subscriber SECRET-123') })
    const good = vi.fn(); session.subscribe(good)
    armed = true
    await expect(session.signOut()).resolves.toBeUndefined()
    expect(store.value).toBeNull()
    expect(good).toHaveBeenCalled()                                // later subscribers still ran
    expect(JSON.stringify(err.mock.calls)).not.toContain('SECRET-123')
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('a throwing subscriber cannot reject init()\'s ready promise (so getAccessToken keeps working)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = vi.fn(async () => json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 }))
    const { session } = setup({ fetchFn: f as unknown as typeof fetch })
    let armed = false
    session.subscribe(() => { if (armed) throw new Error('boom') })
    armed = true
    await expect(session.init()).resolves.toBeUndefined()
    await expect(session.getAccessToken()).resolves.toBeTruthy()
    err.mockRestore()
  })
  it('a transient refresh failure returns the access token that is still valid (R7 intact: the refresh token is kept)', async () => {
    let n = 0
    const f = vi.fn(async () => { if (++n === 1) return json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 }); throw new TypeError('offline') })
    const { session, clock, store } = setup({ fetchFn: f as unknown as typeof fetch })
    await session.init()
    const first = await session.getAccessToken()
    clock.t += 870_000                                             // 30 s left: inside the 60 s refresh margin, but still valid
    await expect(session.getAccessToken()).resolves.toBe(first)    // refresh failed (offline) -> keep serving the valid token
    expect(f).toHaveBeenCalledTimes(2)
    expect(store.value).toBe('R2')
    clock.t += 40_000                                              // now expired: nothing valid to serve
    await expect(session.getAccessToken()).resolves.toBeNull()
    expect(store.value).toBe('R2')
  })
  it('a 401 on refresh clears the session even when the old access token had not expired (only transient failures fall back)', async () => {
    let n = 0
    const f = vi.fn(async () => (++n === 1 ? json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 }) : json(401)))
    const { session, clock, store } = setup({ fetchFn: f as unknown as typeof fetch })
    await session.init()
    clock.t += 870_000
    await expect(session.getAccessToken()).resolves.toBeNull()
    expect(store.value).toBeNull()
  })
  it('isSignedIn() reflects the in-memory access token', async () => {
    const { session } = setup({ fetchFn: vi.fn(async () => json(200, { accessToken: fresh(), refreshToken: 'R2', expiresIn: 900 })) as unknown as typeof fetch })
    expect(session.isSignedIn()).toBe(false)
    await session.init()
    expect(session.isSignedIn()).toBe(true)
    await session.signOut()
    expect(session.isSignedIn()).toBe(false)
  })
})

describe('R15 follow-up: several handoffs may be tracked at once (a native startup tracks the whole listener setup AND the redeem inside it)', () => {
  it('getAccessToken waits for ALL of them, not just the most recently registered', async () => {
    const { session } = setup({ store: memoryStore(null) })
    const outer = deferred<void>(); const inner = deferred<void>()
    session.trackHandoff(outer.promise)
    session.trackHandoff(inner.promise)
    let resolved = false
    const p = session.getAccessToken().then((t) => { resolved = true; return t })
    inner.resolve(); await new Promise((r) => setTimeout(r, 0))
    expect(resolved).toBe(false)                                   // the outer one is still pending
    outer.resolve(); await p
    expect(resolved).toBe(true)
  })
})
