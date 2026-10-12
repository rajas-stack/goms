import { SignJWT, decodeJwt } from 'jose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearOauthEnv, TEST_SESSION_SECRET, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'
import { OAuthConfigError } from './config.js'
import { AccessTokenError, isGomsToken, signAccessToken, verifyAccessToken } from './accessToken.js'

beforeEach(() => useOauthEnv('both'))
afterEach(clearOauthEnv)
const claims = { uid: 'g:123', email: 'someone@amnex.com', familyId: '22222222-2222-2222-2222-222222222222' }

describe('access token', () => {
  it('round-trips the identity and lives 15 minutes by default', async () => {
    const { token, expiresIn } = await signAccessToken(claims)
    expect(expiresIn).toBe(900)
    await expect(verifyAccessToken(token)).resolves.toEqual(claims)
  })
  it('carries exactly iss/aud/sub/email/sid/iat/exp — no roles, no permissions', async () => {
    const { token } = await signAccessToken(claims)
    expect(Object.keys(decodeJwt(token)).sort()).toEqual(['aud', 'email', 'exp', 'iat', 'iss', 'sid', 'sub'])
    expect(decodeJwt(token)).toMatchObject({ iss: 'goms', aud: 'goms-api', sub: 'g:123', sid: claims.familyId })
  })
  it('honours AUTH_ACCESS_TTL_SECONDS', async () => {
    process.env.AUTH_ACCESS_TTL_SECONDS = '120'
    expect((await signAccessToken(claims)).expiresIn).toBe(120)
  })
  it.each([['0.5'], ['0'], ['-1'], ['abc']])('AUTH_ACCESS_TTL_SECONDS=%s falls back to 900 s instead of issuing an instantly-expired token', async (raw) => {
    process.env.AUTH_ACCESS_TTL_SECONDS = raw
    const { token, expiresIn } = await signAccessToken(claims)
    expect(expiresIn).toBe(900)
    await expect(verifyAccessToken(token)).resolves.toEqual(claims)
  })
  it('floors a fractional TTL above 1 (1.9 -> 1 s)', async () => {
    process.env.AUTH_ACCESS_TTL_SECONDS = '1.9'
    expect((await signAccessToken(claims)).expiresIn).toBe(1)
  })
  it('rejects an expired token as expired', async () => {
    const { token } = await signAccessToken(claims, new Date(Date.now() - 3600_000))
    await expect(verifyAccessToken(token)).rejects.toMatchObject({ name: 'AccessTokenError', kind: 'expired' })
  })
  it('rejects a token signed with another key, another issuer/audience, or alg=none', async () => {
    const key = new TextEncoder().encode('z'.repeat(40))
    const forged = await new SignJWT({ email: claims.email, sid: claims.familyId }).setProtectedHeader({ alg: 'HS256' })
      .setIssuer('goms').setAudience('goms-api').setSubject('g:1').setIssuedAt().setExpirationTime('5m').sign(key)
    await expect(verifyAccessToken(forged)).rejects.toBeInstanceOf(AccessTokenError)
    const secret = new TextEncoder().encode(TEST_SESSION_SECRET)
    for (const [iss, aud] of [['evil', 'goms-api'], ['goms', 'other']]) {
      const t = await new SignJWT({ email: claims.email, sid: claims.familyId }).setProtectedHeader({ alg: 'HS256' })
        .setIssuer(iss).setAudience(aud).setSubject('g:1').setIssuedAt().setExpirationTime('5m').sign(secret)
      await expect(verifyAccessToken(t)).rejects.toBeInstanceOf(AccessTokenError)
    }
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: 'goms', aud: 'goms-api', sub: 'g:1', email: 'a@amnex.com', sid: 'x', exp: 9999999999 })).toString('base64url')}.`
    await expect(verifyAccessToken(none)).rejects.toBeInstanceOf(AccessTokenError)
  })
  it.each([['exp'], ['iat'], ['sub']])('rejects a token that is signed with the right key but has no %s claim', async (missing) => {
    const secret = new TextEncoder().encode(TEST_SESSION_SECRET)
    const jwt = new SignJWT({ email: claims.email, sid: claims.familyId }).setProtectedHeader({ alg: 'HS256' }).setIssuer('goms').setAudience('goms-api')
    if (missing !== 'sub') jwt.setSubject('g:1')
    if (missing !== 'iat') jwt.setIssuedAt()
    if (missing !== 'exp') jwt.setExpirationTime('5m')
    await expect(verifyAccessToken(await jwt.sign(secret))).rejects.toMatchObject({ name: 'AccessTokenError', kind: 'invalid' })
  })
  it('a missing or short AUTH_SESSION_SECRET is a CONFIGURATION error, not "this token is invalid"', async () => {
    const { token } = await signAccessToken(claims)
    delete process.env.AUTH_SESSION_SECRET
    await expect(verifyAccessToken(token)).rejects.toBeInstanceOf(OAuthConfigError)
    process.env.AUTH_SESSION_SECRET = 'too-short'
    await expect(verifyAccessToken(token)).rejects.toBeInstanceOf(OAuthConfigError)
    await expect(verifyAccessToken('not-even-a-jwt')).rejects.toBeInstanceOf(OAuthConfigError) // the key is checked before the token is looked at
  })
  it('rejects a token missing email or sid', async () => {
    const secret = new TextEncoder().encode(TEST_SESSION_SECRET)
    const t = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setIssuer('goms').setAudience('goms-api').setSubject('g:1').setIssuedAt().setExpirationTime('5m').sign(secret)
    await expect(verifyAccessToken(t)).rejects.toBeInstanceOf(AccessTokenError)
  })
})

describe('isGomsToken (unverified peek used only to route verification)', () => {
  it('is true for a GOMS-looking JWT and false for Firebase-style or garbage tokens', async () => {
    expect(isGomsToken((await signAccessToken(claims)).token)).toBe(true)
    expect(isGomsToken('fake.eyJ1aWQiOiJ4In0')).toBe(false)
    expect(isGomsToken('not-a-jwt')).toBe(false)
    expect(isGomsToken('')).toBe(false)
  })
})
