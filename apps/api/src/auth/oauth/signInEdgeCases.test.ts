// apps/api/src/auth/oauth/signInEdgeCases.test.ts
// Two sign-in edge cases that the 2026-10-22 goms-dev rehearsal could NOT exercise on the real service, covered here deterministically
// over real HTTP through the Firebase Hosting stand-in (testHelpers/hostingProxy.ts):
//
//   R6  two sign-ins start at once from a browser that has no `__session` cookie yet (the very first visit).
//   R7  the person cancels at Google's consent screen.
//
// What these tests are: a deterministic model of the browser's cookie behaviour (a jar that applies Set-Cookie headers in the order we
// choose) in front of the real API code. What they are NOT: evidence about the real Hosting service or a real browser. R6 on the real
// service was INCONCLUSIVE (the requests never overlapped) and R7 was NOT VERIFIED there; neither is reported as passed on it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import { buildApp } from '../../app.js'
import { pool } from '../../db.js'
import { Browser, startHostingProxy, type HostingProxy } from '../../testHelpers/hostingProxy.js'
import { cleanupOauthTables, clearOauthEnv, fakeGoogle, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'

let app: Awaited<ReturnType<typeof buildApp>>
let proxy: HostingProxy
let warnSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>
const browser = () => new Browser(proxy.origin)

beforeAll(() => { clearOauthEnv() })
beforeEach(async () => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  useOauthEnv('both'); await cleanupOauthTables()
  app = await buildApp({ oauth: { google: fakeGoogle().gateway }, rateLimit: { max: 10_000, timeWindow: '1 minute' } })
  await app.listen({ port: 0, host: '127.0.0.1' })
  proxy = await startHostingProxy((app.server.address() as AddressInfo).port)
})
afterEach(async () => { await proxy.close(); await app.close(); clearOauthEnv(); warnSpy.mockRestore(); errorSpy.mockRestore(); await cleanupOauthTables() })
afterAll(() => pool.end?.().catch(() => {}))

const stateOf = (r: Response) => new URL(r.headers.get('location')!).searchParams.get('state')!
const callback = (b: Browser, state: string, query = 'code=google-code') => b.request(`/api/oauth/google/callback?${query}&state=${encodeURIComponent(state)}`)
const failedWith = (r: Response, reason: string) => r.status === 302 && new URL(r.headers.get('location')!).searchParams.get('auth_error') === reason
const authCode = (r: Response) => (r.status === 302 ? new URL(r.headers.get('location')!).searchParams.get('auth_code') : null)
const count = async (table: string) => Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count)
const exchange = (b: Browser, code: string) => b.request('/api/oauth/exchange', { method: 'POST', body: { code, client: 'web' } })

/** One `/start` sent WITHOUT any cookie and with its response held back: what the browser does when two tabs or two clicks fire before
 *  either response has arrived. Returns the state and the raw `Set-Cookie`, which the caller applies to the jar in a chosen order. */
async function startWithoutCookie(): Promise<{ state: string; setCookie: string }> {
  const r = await fetch(`${proxy.origin}/api/oauth/google/start?client=web&return_to=%2F`, { redirect: 'manual' })
  expect(r.status).toBe(302)
  const [setCookie] = r.headers.getSetCookie()
  expect(setCookie).toMatch(/^__session=/)
  return { state: stateOf(r), setCookie }
}
/** A browser applying one Set-Cookie header (a later one replaces an earlier one of the same name). */
function applySetCookie(b: Browser, raw: string) {
  const [pair] = raw.split(';'); const at = pair.indexOf('=')
  b.jar.set(pair.slice(0, at), { value: pair.slice(at + 1), path: '/api' })
}

describe('R6: two sign-ins start at once from a browser with no cookie yet', () => {
  it('the two starts mint two different browser ids (the race is real, not a reuse of one id)', async () => {
    const [a, b] = [await startWithoutCookie(), await startWithoutCookie()]
    expect(a.setCookie.split(';')[0]).not.toEqual(b.setCookie.split(';')[0])
  })

  it.each([['second', 'the last Set-Cookie to arrive wins'], ['first', 'whichever response lands last wins, in either order']] as const)(
    'when the %s response lands last: exactly that flow completes, the other fails safely with auth_error=state, and nothing is issued for it (%s)',
    async (lastToLand, _why) => {
      const b = browser()
      const first = await startWithoutCookie(), second = await startWithoutCookie()
      const [winner, loser] = lastToLand === 'second' ? [second, first] : [first, second]
      applySetCookie(b, loser.setCookie); applySetCookie(b, winner.setCookie) // the browser keeps ONE `__session`: the last one applied

      const lost = await callback(b, loser.state)
      expect(failedWith(lost, 'state')).toBe(true)
      expect(await count('auth_exchange_codes')).toBe(0) // the failed flow produced no code and no session
      expect(await count('auth_sessions')).toBe(0)

      const won = await callback(b, winner.state)
      const code = authCode(won)
      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(await count('auth_exchange_codes')).toBe(1) // exactly one code for the whole race: never two sign-ins, never zero
      expect((await exchange(b, code!)).status).toBe(200)
      expect(await count('auth_sessions')).toBe(1)
    })

  it('after the race the person simply signs in again: the browser now holds a cookie, so a retry completes', async () => {
    const b = browser()
    const first = await startWithoutCookie(), second = await startWithoutCookie()
    applySetCookie(b, first.setCookie); applySetCookie(b, second.setCookie)
    expect(failedWith(await callback(b, first.state), 'state')).toBe(true) // the person sees the sign-in prompt again

    const retry = await b.request('/api/oauth/google/start?client=web&return_to=%2F')
    expect(retry.status).toBe(302)
    const done = await callback(b, stateOf(retry))
    expect(authCode(done)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect((await exchange(b, authCode(done)!)).status).toBe(200)
  })

  it('a loser can never be completed later by any browser, including the one that holds the winning cookie, and does not disturb the winner', async () => {
    const b = browser(), stranger = browser()
    const first = await startWithoutCookie(), second = await startWithoutCookie()
    applySetCookie(b, first.setCookie); applySetCookie(b, second.setCookie) // `second` wins
    await stranger.request('/api/oauth/google/start?client=web')
    expect(failedWith(await callback(stranger, first.state), 'state')).toBe(true)
    expect(failedWith(await callback(b, first.state), 'state')).toBe(true)
    expect(failedWith(await callback(b, first.state), 'state')).toBe(true) // still refused on every repeat
    expect(authCode(await callback(b, second.state))).not.toBeNull()
  })
})

describe('R7: the person cancels at Google (error=access_denied on the callback)', () => {
  const cancel = (b: Browser, state: string) => callback(b, state, 'error=access_denied')

  it('web: reported as auth_error=denied, no code and no session, and the cancelled flow cannot be reused', async () => {
    const b = browser()
    const state = stateOf(await b.request('/api/oauth/google/start?client=web&return_to=%2Fsales'))
    const res = await cancel(b, state)
    expect(failedWith(res, 'denied')).toBe(true)
    expect(new URL(res.headers.get('location')!).searchParams.has('auth_code')).toBe(false)
    expect(await count('auth_exchange_codes')).toBe(0); expect(await count('auth_sessions')).toBe(0)
    expect(failedWith(await cancel(b, state), 'state')).toBe(true) // single use, even for a cancellation
    expect(failedWith(await callback(b, state), 'state')).toBe(true) // and a real code cannot be swapped in afterwards
    expect(proxy.strippedSetCookies()).toBe(0)
  })

  it('web: the person can try again right after cancelling, in the same browser, and sign in', async () => {
    const b = browser()
    expect(failedWith(await cancel(b, stateOf(await b.request('/api/oauth/google/start?client=web'))), 'denied')).toBe(true)
    const done = await callback(b, stateOf(await b.request('/api/oauth/google/start?client=web')))
    expect(authCode(done)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect((await exchange(b, authCode(done)!)).status).toBe(200)
  })

  it('web: a cancel arriving in a different browser is refused as "state" and does not burn the real flow', async () => {
    const a = browser(), other = browser()
    const state = stateOf(await a.request('/api/oauth/google/start?client=web'))
    await other.request('/api/oauth/google/start?client=web')
    expect(failedWith(await cancel(other, state), 'state')).toBe(true)
    expect(failedWith(await cancel(browser(), state), 'state')).toBe(true) // no cookie at all
    expect(failedWith(await cancel(a, state), 'denied')).toBe(true) // the owner's own cancel still reports as a cancel
  })

  it('app (Custom Tab): the page hands the app error=denied for this deployment\'s own scheme, with no code', async () => {
    const b = browser()
    const state = stateOf(await b.request('/api/oauth/google/start?client=app'))
    const res = await cancel(b, state)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toMatch(/no-store/)
    const page = await res.text()
    expect(page).toContain('com.gorms.app://auth?error=denied')
    expect(page).not.toMatch(/code=/)
    expect(await count('auth_exchange_codes')).toBe(0)
  })

  it('emits only the reason code in the log, never the state or any Google text', async () => {
    const b = browser()
    const state = stateOf(await b.request('/api/oauth/google/start?client=web'))
    await callback(b, state, 'error=access_denied&error_description=secret-google-text')
    const lines = warnSpy.mock.calls.map((call: unknown[]) => String(call[0]))
    expect(lines).toContain(JSON.stringify({ event: 'oauth.fail', reason: 'denied' }))
    expect(lines.join('\n')).not.toMatch(new RegExp(`${state.slice(0, 12)}|secret-google-text|access_denied`))
  })
})
