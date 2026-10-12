import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APP_SCHEMES, OAuthConfigError, accessTtlSeconds, appScheme, authProvider, firebaseAccepted, gomsAccepted, oauthConfig, oauthEnabled, refreshTtlDays, sessionKey, ttlSetting,
} from './config.js'

const KEYS = ['AUTH_PROVIDER', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI', 'AUTH_SESSION_SECRET',
  'OAUTH_WEB_ORIGIN', 'AUTH_ACCESS_TTL_SECONDS', 'AUTH_REFRESH_TTL_DAYS', 'CORS_ALLOWED_ORIGINS', 'OAUTH_APP_SCHEME']
afterEach(() => { for (const k of KEYS) delete process.env[k]; vi.restoreAllMocks() })
const full = () => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid.apps.googleusercontent.com'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'shh'
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://goms-dev.firebaseapp.com/api/oauth/google/callback'
  process.env.AUTH_SESSION_SECRET = 'x'.repeat(48)
}

describe('authProvider', () => {
  it('defaults to firebase and treats OAuth as disabled', () => {
    expect(authProvider()).toBe('firebase')
    expect(oauthEnabled()).toBe(false); expect(gomsAccepted()).toBe(false); expect(firebaseAccepted()).toBe(true)
  })
  it.each([['both', true, true], ['oauth', true, false]] as const)('%s', (value, goms, firebase) => {
    process.env.AUTH_PROVIDER = ` ${value.toUpperCase()} `
    expect(authProvider()).toBe(value); expect(gomsAccepted()).toBe(goms); expect(firebaseAccepted()).toBe(firebase)
  })
  it('falls back to firebase (and says so) for an unknown value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.AUTH_PROVIDER = 'okta'
    expect(authProvider()).toBe('firebase')
    expect(warn).toHaveBeenCalled()
  })
})

describe('sessionKey', () => {
  it('requires at least 32 bytes', () => {
    process.env.AUTH_SESSION_SECRET = 'short'
    expect(() => sessionKey()).toThrow(OAuthConfigError)
    process.env.AUTH_SESSION_SECRET = 'y'.repeat(32)
    expect(sessionKey()).toHaveLength(32)
  })
})

describe('oauthConfig', () => {
  it('names the missing variables but never their values', () => {
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'super-secret-value'
    let message = ''
    try { oauthConfig() } catch (e) { message = (e as Error).message }
    expect(message).toMatch(/GOOGLE_OAUTH_CLIENT_ID/)
    expect(message).not.toMatch(/super-secret-value/)
  })
  it('reads a complete configuration with defaults (900 s / 30 d, web origin = redirect origin)', () => {
    full()
    expect(oauthConfig()).toMatchObject({
      clientId: 'cid.apps.googleusercontent.com', webOrigin: 'https://goms-dev.firebaseapp.com', accessTtlSeconds: 900, refreshTtlDays: 30,
    })
  })
  it('accepts configured TTLs and ignores nonsense', () => {
    full(); process.env.AUTH_ACCESS_TTL_SECONDS = '600'; process.env.AUTH_REFRESH_TTL_DAYS = 'abc'
    expect(oauthConfig()).toMatchObject({ accessTtlSeconds: 600, refreshTtlDays: 30 })
  })
  it.each([
    'http://goms-dev.firebaseapp.com/api/oauth/google/callback', // plain http, non-local
    'https://goms-dev.firebaseapp.com/other',                    // wrong path
    'https://goms-dev.firebaseapp.com/api/oauth/google/callback?x=1',
    'not a url',
  ])('rejects redirect URI %s', (uri) => {
    full(); process.env.GOOGLE_OAUTH_REDIRECT_URI = uri
    expect(() => oauthConfig()).toThrow(OAuthConfigError)
  })
  it('allows an http localhost redirect URI for local development', () => {
    full(); process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:8080/api/oauth/google/callback'
    expect(oauthConfig().webOrigin).toBe('http://localhost:8080')
  })
  it('OAUTH_WEB_ORIGIN must be the redirect origin, the Vite origin or a CORS origin — nothing else', () => {
    full()
    process.env.OAUTH_WEB_ORIGIN = 'http://localhost:5173'
    expect(oauthConfig().webOrigin).toBe('http://localhost:5173')
    process.env.OAUTH_WEB_ORIGIN = 'https://evil.example'
    expect(() => oauthConfig()).toThrow(OAuthConfigError)
    process.env.CORS_ALLOWED_ORIGINS = 'https://evil.example'
    expect(oauthConfig().webOrigin).toBe('https://evil.example') // an operator-approved origin is allowed
  })
})

describe('appScheme (per-environment deep-link scheme, Q1)', () => {
  it('defaults to the prod scheme so an unset variable changes nothing', () => {
    expect(appScheme()).toBe('com.gorms.app')
    process.env.OAUTH_APP_SCHEME = '  '
    expect(appScheme()).toBe('com.gorms.app')
  })
  it('accepts exactly the two allowed schemes', () => {
    expect([...APP_SCHEMES]).toEqual(['com.gorms.app', 'com.gorms.app.dev'])
    for (const v of APP_SCHEMES) { process.env.OAUTH_APP_SCHEME = v; expect(appScheme()).toBe(v) }
  })
  it.each(['evil.app', 'com.gorms.app.staging', 'COM.GORMS.APP', 'javascript', 'com.gorms.app://', 'https'])('refuses %s (never an arbitrary scheme)', (v) => {
    process.env.OAUTH_APP_SCHEME = v
    expect(() => appScheme()).toThrow(OAuthConfigError)
  })
})

describe('TTL parsing (one shared helper: floor FIRST, then require > 0, else the default)', () => {
  it.each([
    ['0.5', 900], ['0.999', 900], ['0', 900], ['-1', 900], ['abc', 900], ['', 900], ['  ', 900], ['Infinity', 900], ['1.9', 1], ['600', 600], [' 120 ', 120],
  ] as const)('ttlSetting(%j, 900) -> %s', (raw, expected) => { expect(ttlSetting(raw, 900)).toBe(expected) })
  it('ttlSetting(undefined) is the default', () => { expect(ttlSetting(undefined, 30)).toBe(30) })

  it.each([['0.5', 900, 30], ['0', 900, 30], ['-1', 900, 30], ['abc', 900, 30], ['600', 600, 600]] as const)(
    'AUTH_ACCESS_TTL_SECONDS / AUTH_REFRESH_TTL_DAYS = %j gives access %s s and refresh %s d, from the same helper in all three consumers', (raw, access, refresh) => {
      process.env.AUTH_ACCESS_TTL_SECONDS = raw; process.env.AUTH_REFRESH_TTL_DAYS = raw
      expect(accessTtlSeconds()).toBe(access)
      expect(refreshTtlDays()).toBe(refresh)
      full()
      expect(oauthConfig()).toMatchObject({ accessTtlSeconds: access, refreshTtlDays: refresh })
    })
  it('needs no Google environment at all', () => {
    expect(accessTtlSeconds()).toBe(900); expect(refreshTtlDays()).toBe(30)
  })
})
