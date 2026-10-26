import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { browserBindingCookie, hasBrowserBinding } from './browserBinding.js'

beforeEach(() => {
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'fixture')
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'fixture')
  vi.stubEnv('AUTH_SESSION_SECRET', 'x'.repeat(40))
  vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'https://goms.test/api/oauth/google/callback')
})
afterEach(() => vi.unstubAllEnvs())
const token = 'a'.repeat(43)
it('uses Secure, HttpOnly, SameSite and a host-only cookie in HTTPS deployments', () => {
  const cookie = browserBindingCookie('login', token)
  expect(cookie).toMatch(/^__Host-goms_login_/)
  expect(cookie).toContain('HttpOnly; SameSite=Lax; Path=/; Max-Age=600; Secure')
  expect(cookie).not.toContain('Domain=')
  expect(hasBrowserBinding('login', token, cookie.split(';')[0])).toBe(true)
})
it('rejects missing, tampered, duplicated, wrong-flow and wrong-purpose cookies', () => {
  const pair = browserBindingCookie('login', token).split(';')[0]
  expect(hasBrowserBinding('login', token, undefined)).toBe(false)
  expect(hasBrowserBinding('login', token, pair.slice(0, -1) + '!')).toBe(false)
  expect(hasBrowserBinding('login', token, pair + '; ' + pair)).toBe(false)
  expect(hasBrowserBinding('login', 'b'.repeat(43), pair)).toBe(false)
  expect(hasBrowserBinding('exchange', token, pair)).toBe(false)
  expect(hasBrowserBinding('login', 'invalid', pair)).toBe(false)
})
it('permits HTTP localhost and expires the exact binding cookie', () => {
  vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'http://localhost:8088/api/oauth/google/callback')
  const cookie = browserBindingCookie('exchange', token)
  expect(cookie).not.toMatch(/__Host-|; Secure/)
  expect(hasBrowserBinding('exchange', token, cookie.split(';')[0])).toBe(true)
  expect(browserBindingCookie('exchange', token, true)).toContain('=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
})
