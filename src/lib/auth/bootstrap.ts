import { raiseAuthReason, setPendingAuthReason, type AuthPromptReason } from '@/lib/authPrompt'

/** The one-time handoff parameters the API appends to the web return URL. */
export const HANDOFF_PARAMS = ['auth_code', 'auth_error'] as const

/** SYNCHRONOUS on purpose: the one-time code is removed from the address bar (and so from history, Referer and screenshots)
 *  before any await. Only the exchange code ever appears in a URL — never an access or refresh token. The rewrite is always a
 *  same-origin RELATIVE url built from pathname/search/hash, so it can never navigate or re-point anywhere else. */
export function takeAuthParams(href: string, history: Pick<History, 'replaceState' | 'state'>): { code?: string; error?: string } {
  const url = new URL(href)
  const code = url.searchParams.get('auth_code') ?? undefined
  const error = url.searchParams.get('auth_error') ?? undefined
  if (code !== undefined || error !== undefined) {
    for (const name of HANDOFF_PARAMS) url.searchParams.delete(name)
    // Collapse leading slashes: a "//host/..." target would resolve cross-origin and make replaceState throw.
    const target = `/${url.pathname.replace(/^\/+/, '')}${url.search}${url.hash}`
    try {
      history.replaceState(history.state, '', target)
    } catch {
      // Never let a failed rewrite stop the handoff: the code is still returned and redeemed. Nothing is logged (no code, no details).
    }
  }
  return { code, error }
}

/** Parameters stripped by `stripAuthParamsEarly`, waiting for `bootstrapAuth` (consumed once). */
let stashed: { code?: string; error?: string } | null = null

/** Runs BEFORE the router exists (via ./earlyHandoff, the first import of main.tsx). `createBrowserRouter` captures the initial location when it
 *  is created, so a strip performed later is invisible to it and any functional setSearchParams would put the spent code back into the address
 *  bar. The stripped values are kept for `bootstrapAuth`, which redeems them. */
export function stripAuthParamsEarly(win: { location: { href: string }; history: History }): void {
  stashed = takeAuthParams(win.location.href, win.history)
}

export async function bootstrapAuth(
  session: {
    redeem(code: string, client: 'web' | 'app'): Promise<void>
    init(): Promise<void>
    /** Lets token reads wait for the in-flight redeem, so the first queries after the redirect neither 401 nor flash the sign-in dialog. */
    trackHandoff(handoff: Promise<unknown>): void
  },
  win: { location: { href: string }; history: History },
): Promise<void> {
  const early = stashed
  stashed = null
  const { code, error } = early ?? takeAuthParams(win.location.href, win.history)
  // No details are ever shown or logged: only which kind of prompt to raise.
  if (error) setPendingAuthReason(error === 'domain' || error === 'unverified' ? 'forbidden' : 'unauthorized')
  if (code) {
    try {
      const redeem = session.redeem(code, 'web')
      session.trackHandoff(redeem)
      await redeem
      return
    } catch {
      setPendingAuthReason('unauthorized')
    }
  }
  await session.init()
}

/** The Android shell: the sign-in completes in the SYSTEM browser and comes back as a deep link, so the listener must be registered
 *  BEFORE the stored session is restored (a cold start may be the very link that carries the code). The plugins load lazily so the
 *  browser build never imports them. The code is never logged.
 *
 *  The whole startup (plugin import, listener registration, launch-URL lookup, redeem) is ONE promise handed to `trackHandoff` synchronously -
 *  before any await - so the first render's queries wait for it instead of going out unauthenticated (401 -> prompt flash); `init()` runs once it
 *  has settled.
 *
 *  Capacitor never clears the launch URL, so every WebView reload in the same Activity re-delivers the original, by then spent, link. A failure
 *  of THAT link is therefore only shown when `init()` leaves the user signed out; a failure of a warm link always is. */
export async function bootstrapNativeAuth(
  session: {
    redeem(code: string, client: 'web' | 'app'): Promise<void>
    init(): Promise<void>
    /** Lets token reads wait for the in-flight startup/redeem, so a cold start's first queries neither 401 nor flash the sign-in dialog. */
    trackHandoff(handoff: Promise<unknown>): void
    /** True when a session is held after `init()` (restored from the keystore or just redeemed). */
    isSignedIn(): boolean
  },
  scheme: string,
): Promise<void> {
  const launch: { failure: AuthPromptReason | null } = { failure: null }
  const onLink = (isLaunch: boolean) => async ({ code, error }: { code?: string; error?: string }) => {
    // raiseAuthReason: the dialog subscribed once at mount, so a warm link must reach it directly (pending is only for "not mounted yet").
    const fail = (reason: AuthPromptReason) => { if (isLaunch) launch.failure = reason; else raiseAuthReason(reason) }
    if (error) fail(error === 'domain' || error === 'unverified' ? 'forbidden' : 'unauthorized')
    if (code) {
      try {
        const redeem = session.redeem(code, 'app')
        session.trackHandoff(redeem)
        await redeem
      } catch {
        // Expired/used code, network or keystore failure: tell the user, and log nothing (no code, no error details).
        fail('unauthorized')
      }
    }
  }
  const startup = (async () => {
    const { listenForAuthDeepLinks } = await import('./native')
    await listenForAuthDeepLinks(scheme, onLink(false), onLink(true))
  })()
  session.trackHandoff(startup)
  // A plugin fault must not leave `loading` set forever: carry on to init() (signed out unless a session is restored). Fixed message only.
  try { await startup } catch { console.error('Sign-in links are unavailable.') }
  await session.init()
  if (launch.failure && !session.isSignedIn()) raiseAuthReason(launch.failure)
}
