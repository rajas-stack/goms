// src/lib/auth/session.ts
export interface TokenStore { get(): Promise<string | null>; set(token: string): Promise<void>; clear(): Promise<void> }
export interface LockManagerLike { request<T>(name: string, callback: () => Promise<T>): Promise<T> }
export interface SessionDeps {
  apiBase: string
  fetchFn: typeof fetch
  store: TokenStore
  /** `navigator.locks` on the web (cross-tab); null where unavailable (then only single-flight protects the token). */
  locks: LockManagerLike | null
  now: () => number
}
export interface SessionUser { email: string }
type Listener = (user: SessionUser | null, loading: boolean) => void

const REFRESH_SKEW_MS = 60_000
const LOCK_NAME = 'goms-auth-refresh'

function decodeAccess(jwt: string): { email: string; expiresAt: number } {
  const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  return { email: String(payload.email), expiresAt: Number(payload.exp) * 1000 }
}

/** The lifetime the server states, in seconds - only when it is a usable positive number. */
const usableExpiresIn = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** The browser/app side of the GOMS session. Access token: memory only. Refresh token: the injected store. Pure of globals so it
 *  is unit-testable; `oauthProvider.ts` wires the real fetch, storage and locks. */
export function createSession(deps: SessionDeps) {
  let access: { token: string; expiresAt: number; email: string } | null = null
  let loading = true
  let inflight: Promise<string | null> | null = null
  let ready: Promise<void> = Promise.resolve()
  /** Handoffs in flight (a web auth_code redeem, or a native startup's listener setup + redeem); getAccessToken waits for ALL of them so the first
   *  queries after a redirect / cold start do not 401. They never reject. */
  const pendingHandoffs = new Set<Promise<void>>()
  const listeners = new Set<Listener>()
  /** One throwing subscriber must not skip the others, abort signOut before store.clear(), or reject init()'s `ready`. Fixed message only. */
  const emit = () => {
    for (const l of listeners) {
      try { l(access ? { email: access.email } : null, loading) } catch { console.error('An auth state listener failed.') }
    }
  }
  /** Expiry is the DEVICE clock at receipt + the server's `expiresIn`: the JWT `exp` is server time, and a device clock that is fast (or slow)
   *  would otherwise refresh on every read (or serve an expired token). The JWT is only decoded for the email, and for `exp` as a fallback. */
  const setAccess = (token: string, expiresIn?: unknown) => {
    const decoded = decodeAccess(token)
    access = { token, email: decoded.email, expiresAt: usableExpiresIn(expiresIn) ? deps.now() + expiresIn * 1000 : decoded.expiresAt }
  }
  const post = (path: string, body: unknown) =>
    deps.fetchFn(`${deps.apiBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  /** Bumped by every sign-in/sign-out/successful rotation. A rotation that started under an older value must not clear or overwrite what a newer
   *  state change put in place (stale 401, or a refresh landing after signOut). */
  let gen = 0

  /** One rotation. Reads the stored token INSIDE the lock so a refresh by another tab is never replayed. Any non-401 problem (offline, 4xx/5xx,
   *  bad body, storage fault) is transient: keep the stored token, return null. */
  async function rotate(): Promise<string | null> {
    const startGen = gen
    try {
      const refreshToken = await deps.store.get()
      if (!refreshToken) { if (gen === startGen) { access = null; emit() } return null }
      let res: Response
      try { res = await post('/api/oauth/refresh', { refreshToken }) } catch { return null }   // offline: keep everything, try later
      if (res.status === 401) {                                                                   // the ONLY signal that the session is gone...
        const current = await deps.store.get()
        if (gen === startGen && current === refreshToken) { await deps.store.clear(); access = null; emit() }   // ...unless a newer token/state replaced it
        return null
      }
      if (!res.ok) return null                                                                    // 400 / 5xx: not proof of revocation, keep the token
      const body = (await res.json()) as { accessToken: string; refreshToken: string; expiresIn?: number }
      if (gen !== startGen) return null                                                           // signed out / signed in elsewhere meanwhile: drop it
      await deps.store.set(body.refreshToken)
      if (gen !== startGen) return null
      setAccess(body.accessToken, body.expiresIn)
      gen++
      emit()
      return body.accessToken
    } catch { return null }
  }

  /** Single-flight within the tab; navigator.locks serialises across tabs. Never rejects. */
  function refresh(): Promise<string | null> {
    inflight ??= (async () => { try { return await (deps.locks ? deps.locks.request(LOCK_NAME, rotate) : rotate()) } catch { return null } })().finally(() => { inflight = null })
    return inflight
  }

  return {
    subscribe(cb: Listener): () => void { listeners.add(cb); cb(access ? { email: access.email } : null, loading); return () => { listeners.delete(cb) } },
    async init(): Promise<void> {
      ready = (async () => { try { if (await deps.store.get()) await refresh() } catch { /* transient: getAccessToken() retries */ } finally { loading = false; emit() } })()
      await ready
    },
    async getAccessToken(): Promise<string | null> {
      await ready
      while (pendingHandoffs.size > 0) await Promise.all([...pendingHandoffs])
      if (access && access.expiresAt - deps.now() > REFRESH_SKEW_MS) return access.token
      const refreshed = await refresh()
      if (refreshed) return refreshed
      // A TRANSIENT failure (offline, 5xx...) inside the refresh margin: the token we hold is still valid, so keep serving it. A 401 (or a
      // missing refresh token) has already cleared `access`, so nothing stale is returned in those cases.
      return access && access.expiresAt > deps.now() ? access.token : null
    },
    /** True while an access token is held in memory (a sign-in or a successful restore happened, and no sign-out/401 since). */
    isSignedIn(): boolean { return access !== null },
    forceRefresh: refresh,
    /** Register an in-flight handoff (a redeem, or a native startup that contains one). getAccessToken() awaits every registered handoff; a
     *  rejection is swallowed here (the caller still owns its own promise). */
    trackHandoff(handoff: Promise<unknown>): void {
      const settled: Promise<void> = handoff.then(() => undefined, () => undefined).then(() => { pendingHandoffs.delete(settled) })
      pendingHandoffs.add(settled)
    },
    async redeem(code: string, client: 'web' | 'app'): Promise<void> {
      const res = await post('/api/oauth/exchange', { code, client })
      if (!res.ok) throw new Error('Sign-in could not be completed.')
      const body = (await res.json()) as { accessToken: string; refreshToken: string; expiresIn?: number }
      gen++
      await deps.store.set(body.refreshToken)
      setAccess(body.accessToken, body.expiresIn)
      loading = false
      emit()
    },
    /** Bumps `gen` first so a rotation still in flight drops its result, waits for it (and, via the lock, for other tabs), then clears local
     *  state and revokes the freshest stored token server-side (best effort; never blocks or fails local sign-out). */
    async signOut(): Promise<void> {
      gen++
      await inflight
      let token: string | null = null
      let ran = false
      const local = async () => {
        ran = true
        try { token = await deps.store.get() } catch { token = null }
        gen++
        access = null
        emit()
        try { await deps.store.clear() } catch { /* best effort */ }
      }
      try { await (deps.locks ? deps.locks.request(LOCK_NAME, local) : local()) } catch { if (!ran) await local() }
      if (token) { try { await post('/api/oauth/logout', { refreshToken: token }) } catch { /* the session expires on its own */ } }
    },
  }
}
export type Session = ReturnType<typeof createSession>
