import { beforeEach, describe, expect, it, vi } from 'vitest'

// ES imports are hoisted above plain statements, so the globals the module reads at load time must be stubbed inside vi.hoisted.
const { env } = vi.hoisted(() => {
  const assign = vi.fn()
  vi.stubGlobal('window', { location: { pathname: '/sales/roster', search: '?a=1', href: 'https://goms.test/sales/roster?a=1', origin: 'https://goms.test', assign }, history: { replaceState: vi.fn(), state: null } })
  vi.stubEnv('VITE_API_BASE_URL', 'https://goms.test/')
  return { env: { assign } }
})
vi.mock('@capacitor/core', () => ({ Capacitor: { isPluginAvailable: () => false } }))
import { inShell, oauthProvider } from './oauthProvider'

beforeEach(() => env.assign.mockReset())

describe('oauthProvider (plain browser)', () => {
  it('is not the shell, and is configured whenever an API base URL is set', () => {
    expect(inShell).toBe(false); expect(oauthProvider.configured).toBe(true); expect(oauthProvider.kind).toBe('oauth')
  })
  it('signIn navigates to /start with client=web and the CURRENT path as return_to (relative only)', async () => {
    await oauthProvider.signIn()
    const url = new URL(env.assign.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://goms.test/api/oauth/google/start')
    expect(url.searchParams.get('client')).toBe('web')
    expect(url.searchParams.get('return_to')).toBe('/sales/roster?a=1')
  })
  it('return_to never carries the one-time handoff params (auth_code / auth_error), but keeps everything else', async () => {
    const loc = (window as unknown as { location: { pathname: string; search: string } }).location
    const saved = { pathname: loc.pathname, search: loc.search }
    try {
      loc.pathname = '/bid-tracker'
      loc.search = '?auth_code=LEAK&sheet=x&auth_error=state'
      await oauthProvider.signIn()
      expect(new URL(env.assign.mock.calls[0][0]).searchParams.get('return_to')).toBe('/bid-tracker?sheet=x')
      env.assign.mockReset()
      loc.search = '?auth_code=LEAK'
      await oauthProvider.signIn()
      expect(new URL(env.assign.mock.calls[0][0]).searchParams.get('return_to')).toBe('/bid-tracker')
    } finally { Object.assign(loc, saved) }
  })
  it('with no stored session, headers are {} and the user is signed out', async () => {
    await expect(oauthProvider.getAuthorizationHeaders()).resolves.toEqual({})
  })
})
