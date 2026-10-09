import { SignJWT, decodeJwt, errors, jwtVerify } from 'jose'
import { accessTtlSeconds, sessionKey } from './config.js'

const ISSUER = 'goms'
const AUDIENCE = 'goms-api'

export interface AccessClaims { uid: string; email: string; familyId: string }

export class AccessTokenError extends Error {
  readonly kind: 'expired' | 'invalid'
  constructor(kind: 'expired' | 'invalid') { super(kind); this.name = 'AccessTokenError'; this.kind = kind }
}

/** Identity only. Roles and permissions are deliberately NOT claims: RBAC is resolved from the email on every request. */
export async function signAccessToken(c: AccessClaims, now = new Date()): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = accessTtlSeconds()
  const iat = Math.floor(now.getTime() / 1000)
  const token = await new SignJWT({ email: c.email, sid: c.familyId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setSubject(c.uid)
    .setIssuedAt(iat).setExpirationTime(iat + expiresIn)
    .sign(sessionKey())
  return { token, expiresIn }
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  // OUTSIDE the try on purpose: a missing/short AUTH_SESSION_SECRET is a server misconfiguration (OAuthConfigError) and must not be
  // reported as "this token is invalid". The caller (identity.ts) logs it and answers the same generic UNAUTHORIZED.
  const key = sessionKey()
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'], requiredClaims: ['exp', 'iat', 'sub'] })
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || typeof payload.sid !== 'string') throw new AccessTokenError('invalid')
    return { uid: payload.sub, email: payload.email, familyId: payload.sid }
  } catch (e) {
    if (e instanceof AccessTokenError) throw e
    throw new AccessTokenError(e instanceof errors.JWTExpired ? 'expired' : 'invalid')
  }
}

/** Unverified: only decides WHICH verifier to run. Never trust the result for authorisation. */
export function isGomsToken(token: string): boolean {
  try { return decodeJwt(token).iss === ISSUER } catch { return false }
}
