// apps/api/src/auth/oauth/googleClient.test.ts
import type { webcrypto } from 'node:crypto'
import { SignJWT, generateKeyPair } from 'jose'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOauthEnv, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'
import { GoogleAuthError, buildAuthUrl, googleGateway, verifyGoogleIdToken } from './googleClient.js'

const CLIENT = 'test-client.apps.googleusercontent.com'
let privateKey: webcrypto.CryptoKey, publicKey: webcrypto.CryptoKey
beforeAll(async () => { ({ privateKey, publicKey } = await generateKeyPair('RS256')) })
const keys = async () => publicKey

const mint = (over: Record<string, unknown> = {}, o: { iss?: string; aud?: string; exp?: number | string; alg?: string } = {}) =>
  new SignJWT({ email: 'Someone@Amnex.com', email_verified: true, nonce: 'N1', ...over })
    .setProtectedHeader({ alg: o.alg ?? 'RS256' }).setIssuer(o.iss ?? 'https://accounts.google.com').setAudience(o.aud ?? CLIENT)
    .setSubject('1234567890').setIssuedAt().setExpirationTime(o.exp ?? '5m').sign(privateKey)
const reason = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof GoogleAuthError ? e.reason : `other:${(e as Error).message}`))

describe('verifyGoogleIdToken', () => {
  it('accepts a valid token and lower-cases the email', async () => {
    await expect(verifyGoogleIdToken(await mint(), 'N1', { clientId: CLIENT, keys })).resolves.toEqual({ sub: '1234567890', email: 'someone@amnex.com' })
  })
  it('accepts the bare accounts.google.com issuer', async () => {
    await expect(verifyGoogleIdToken(await mint({}, { iss: 'accounts.google.com' }), 'N1', { clientId: CLIENT, keys })).resolves.toBeTruthy()
  })
  it.each([
    ['wrong issuer', () => mint({}, { iss: 'https://evil.example' }), 'token'],
    ['wrong audience', () => mint({}, { aud: 'someone-elses-client' }), 'token'],
    ['expired', () => mint({}, { exp: Math.floor(Date.now() / 1000) - 60 }), 'token'],
    ['wrong nonce', () => mint({ nonce: 'OTHER' }), 'nonce'],
    ['missing nonce', () => mint({ nonce: undefined }), 'nonce'],
    ['email not verified', () => mint({ email_verified: false }), 'unverified'],
    ['email_verified as a string', () => mint({ email_verified: 'true' }), 'unverified'],
    ['non-amnex account', () => mint({ email: 'person@gmail.com' }), 'domain'],
    ['lookalike domain', () => mint({ email: 'person@amnex.com.evil.io' }), 'domain'],
    ['no email', () => mint({ email: undefined }), 'unverified'],
  ])('rejects %s', async (_n, make, why) => {
    expect(await reason(verifyGoogleIdToken(await make(), 'N1', { clientId: CLIENT, keys }))).toBe(why)
  })
  it('rejects a token signed by a different key', async () => {
    const other = await generateKeyPair('RS256')
    const t = await new SignJWT({ email: 'a@amnex.com', email_verified: true, nonce: 'N1' }).setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://accounts.google.com').setAudience(CLIENT).setSubject('1').setExpirationTime('5m').sign(other.privateKey)
    expect(await reason(verifyGoogleIdToken(t, 'N1', { clientId: CLIENT, keys }))).toBe('token')
  })
  it('rejects a symmetric (HS256) token even if someone guessed a key', async () => {
    const t = await new SignJWT({ email: 'a@amnex.com', email_verified: true, nonce: 'N1' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuer('https://accounts.google.com').setAudience(CLIENT).setSubject('1').setExpirationTime('5m').sign(new TextEncoder().encode('k'.repeat(40)))
    expect(await reason(verifyGoogleIdToken(t, 'N1', { clientId: CLIENT, keys }))).toBe('token')
  })
  it('rejects garbage', async () => { expect(await reason(verifyGoogleIdToken('not.a.jwt', 'N1', { clientId: CLIENT, keys }))).toBe('token') })
})

describe('buildAuthUrl', () => {
  beforeEach(() => useOauthEnv('both'))
  afterEach(clearOauthEnv)
  it('asks Google for a code with S256 PKCE, state, nonce, the exact redirect URI, and the domain hint', () => {
    const u = new URL(buildAuthUrl({ state: 'S', nonce: 'N', challenge: 'C' }))
    expect(`${u.origin}${u.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'test-client.apps.googleusercontent.com', redirect_uri: 'https://goms.test/api/oauth/google/callback', response_type: 'code',
      scope: 'openid email profile', state: 'S', nonce: 'N', code_challenge: 'C', code_challenge_method: 'S256', hd: 'amnex.com', prompt: 'select_account',
    })
  })
})

describe('googleGateway.exchangeCode (fetch stubbed; no network)', () => {
  beforeEach(() => useOauthEnv('both'))
  afterEach(() => { clearOauthEnv(); vi.unstubAllGlobals() })
  it('posts the code, PKCE verifier, secret and exact redirect URI to the token endpoint and returns the id_token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id_token: 'IDT', access_token: 'x' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(googleGateway.exchangeCode({ code: 'C1', verifier: 'V1' })).resolves.toBe('IDT')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      code: 'C1', client_id: 'test-client.apps.googleusercontent.com', client_secret: 'test-client-secret',
      redirect_uri: 'https://goms.test/api/oauth/google/callback', grant_type: 'authorization_code', code_verifier: 'V1',
    })
  })
  it.each([
    ['non-2xx', () => new Response('{"error":"invalid_grant"}', { status: 400 })],
    ['no id_token', () => new Response('{}', { status: 200 })],
    ['non-JSON body', () => new Response('<html>', { status: 200 })],
  ])('fails with reason exchange on %s, without leaking the secret', async (_n, res) => {
    vi.stubGlobal('fetch', vi.fn(async () => res()))
    const err = await googleGateway.exchangeCode({ code: 'C', verifier: 'V' }).catch((e) => e)
    expect(err).toBeInstanceOf(GoogleAuthError)
    expect(err.reason).toBe('exchange')
    expect(String(err.message) + String(err.stack)).not.toContain('test-client-secret')
  })
  it('fails with reason exchange when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom test-client-secret') }))
    const err = await googleGateway.exchangeCode({ code: 'C', verifier: 'V' }).catch((e) => e)
    expect(err.reason).toBe('exchange')
    expect(err.message).not.toContain('test-client-secret')
  })
})
