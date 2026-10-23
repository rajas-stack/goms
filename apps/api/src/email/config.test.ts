import { describe, expect, it } from 'vitest'
import { emailConfiguration, openEmailCredentials, sealEmailCredentials } from './config.js'
describe('server-only Gmail credentials', () => {
  it('encrypts access and refresh tokens with mailbox-bound authenticated encryption', () => {
    const secret = 'server-secret-that-is-at-least-32-bytes'
    const credentials = { accessToken: 'private-access', refreshToken: 'private-refresh', expiresAt: 1234 }
    const sealed = sealEmailCredentials(credentials, 'mailbox-a:owner@amnex.com', secret)
    expect(JSON.stringify(sealed)).not.toMatch(/private-access|private-refresh/)
    expect(openEmailCredentials(sealed, 'mailbox-a:owner@amnex.com', secret)).toEqual(credentials)
    expect(() => openEmailCredentials(sealed, 'mailbox-b:other@amnex.com', secret)).toThrow()
    expect(() => openEmailCredentials({ ...sealed, tag: Buffer.alloc(16).toString('base64') }, 'mailbox-a:owner@amnex.com', secret)).toThrow()
    expect(sealEmailCredentials(credentials, 'mailbox-a:owner@amnex.com', secret).data).not.toBe(sealed.data)
  })
  it('requires real server configuration and a registered callback, without weakening other authentication', () => {
    const env = { EMAIL_CENTER_ENABLED: 'true', GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', EMAIL_TOKEN_ENCRYPTION_KEY: 'x'.repeat(40), GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:8088/api/oauth/google/callback' }
    expect(emailConfiguration(env).ready).toBe(true)
    expect(emailConfiguration({ ...env, EMAIL_TOKEN_ENCRYPTION_KEY: '' }).ready).toBe(false)
    expect(emailConfiguration({ ...env, EMAIL_TOKEN_ENCRYPTION_KEY: '', AUTH_SESSION_SECRET: 'x'.repeat(40) }).ready).toBe(false) // never borrows the sign-in session secret
    expect(emailConfiguration({ ...env, GOOGLE_OAUTH_REDIRECT_URI: 'http://evil.example/api/oauth/google/callback' }).ready).toBe(false)
    expect(emailConfiguration({ ...env, GOOGLE_OAUTH_REDIRECT_URI: 'https://app.example/other' }).ready).toBe(false)
  })
})
