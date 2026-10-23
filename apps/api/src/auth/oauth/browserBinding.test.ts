import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_COOKIE, browserId, ensureBrowser, flowBinding, newBoundToken, tokenBoundTo } from './browserBinding.js'

beforeEach(() => {
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'fixture')
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'fixture')
  vi.stubEnv('AUTH_SESSION_SECRET', 'x'.repeat(40))
  vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'https://goms.test/api/oauth/google/callback')
})
afterEach(() => vi.unstubAllEnvs())
/** What a browser sends back for a Set-Cookie value: just `name=value`. */
const sent = (setCookie: string) => setCookie.split(';')[0]
const issue = (cookies?: string, secure = true) => ensureBrowser(cookies, secure)

describe('the one Hosting-compatible cookie', () => {
  it('is named __session (the only cookie Firebase Hosting forwards) with HttpOnly, SameSite=Lax, Path=/api and Secure on https', () => {
    const { id, setCookie } = issue()
    expect(BROWSER_COOKIE).toBe('__session')
    expect(setCookie).toMatch(/^__session=[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/api; Max-Age=3600; Secure$/)
    expect(setCookie).not.toMatch(/Domain=|__Host-/)
    expect(browserId(sent(setCookie))).toBe(id)
  })
  it('omits Secure for http localhost', () => {
    expect(issue(undefined, false).setCookie).not.toContain('Secure')
  })
  it('is reused, not re-minted: every flow from one browser shares one id, so concurrent flows need no cookie coordination', () => {
    const first = issue()
    const second = issue(sent(first.setCookie)), third = issue(`theme=dark; ${sent(first.setCookie)}; _ga=1`)
    expect(second.id).toBe(first.id)
    expect(third.id).toBe(first.id)
  })
  it('mints a fresh id for a missing, malformed, forged, foreign or duplicated __session (never trusts one)', () => {
    const real = sent(issue().setCookie)
    const [name, value] = [real.slice(0, real.indexOf('=')), real.slice(real.indexOf('=') + 1)]
    const [id, tag] = value.split('.')
    for (const bad of [undefined, 'other=1', '__session=not-ours', `${name}=${id}.${tag.slice(0, -1)}${tag.endsWith('A') ? 'B' : 'A'}`,
      `${name}=${'z'.repeat(43)}.${tag}`, `${real}; ${real}`, `__session=${'x'.repeat(4000)}`]) {
      expect(browserId(bad)).toBeNull()
      expect(issue(bad).id).not.toBe(id)
    }
  })
  it('a cookie signed under a different server key is not trusted', () => {
    const real = sent(issue().setCookie)
    vi.stubEnv('AUTH_SESSION_SECRET', 'y'.repeat(40))
    expect(browserId(real)).toBeNull()
  })
})

describe('tokens bound to the browser that started the flow', () => {
  let a = '', b = ''
  beforeEach(() => { a = issue().id; b = issue().id })
  it('is a 43-character base64url token (same shape as the unbound token it replaces)', () => {
    expect(newBoundToken('login', a)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newBoundToken('login', a)).not.toBe(newBoundToken('login', a))
  })
  it('verifies only for the same browser and the same purpose', () => {
    const token = newBoundToken('login', a)
    expect(tokenBoundTo('login', token, a)).toBe(true)
    expect(tokenBoundTo('login', token, b)).toBe(false) // another browser
    expect(tokenBoundTo('exchange', token, a)).toBe(false) // another purpose
    expect(tokenBoundTo('login', token, null)).toBe(false) // no cookie
  })
  it('rejects tampered, truncated, non-string and foreign-shaped tokens', () => {
    const token = newBoundToken('exchange', a)
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
    expect(tokenBoundTo('exchange', flipped, a)).toBe(false)
    expect(tokenBoundTo('exchange', 'B' + token.slice(1), a)).toBe(false)
    expect(tokenBoundTo('exchange', token.slice(0, 42), a)).toBe(false)
    expect(tokenBoundTo('exchange', 'a'.repeat(43), a)).toBe(false) // an unbound random token
    for (const junk of [undefined, null, 5, {}, '', 'x'.repeat(200)]) expect(tokenBoundTo('exchange', junk, a)).toBe(false)
  })
})

describe('the Email Center / Profile Images flow binding', () => {
  let a = '', b = ''
  beforeEach(() => { a = issue().id; b = issue().id })
  const state = 'mail.' + 'a'.repeat(43)
  it('is deterministic per browser, state and purpose, and different across any of them', () => {
    const base = flowBinding('mail', state, a)
    expect(flowBinding('mail', state, a)).toBe(base)
    expect(base).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(flowBinding('mail', state, b)).not.toBe(base)
    expect(flowBinding('mail', 'mail.' + 'b'.repeat(43), a)).not.toBe(base)
    expect(flowBinding('profile', state, a)).not.toBe(base)
  })
})

describe('the signing key', () => {
  it('falls back to the Email Center encryption secret when login is not configured', () => {
    vi.stubEnv('AUTH_SESSION_SECRET', '')
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client'); vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'secret')
    vi.stubEnv('EMAIL_CENTER_ENABLED', 'true'); vi.stubEnv('EMAIL_TOKEN_ENCRYPTION_KEY', 'e'.repeat(40))
    const { id, setCookie } = issue()
    expect(browserId(sent(setCookie))).toBe(id)
  })
  it('refuses to issue anything with no usable key at all', () => {
    vi.stubEnv('AUTH_SESSION_SECRET', 'short'); vi.stubEnv('EMAIL_TOKEN_ENCRYPTION_KEY', '')
    expect(() => issue()).toThrow()
  })
})
