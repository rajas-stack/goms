// apps/api/src/auth/oauth/googleClient.ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { isAmnexAccount } from '../identity.js'
import { oauthConfig } from './config.js'
import { CALENDAR_SCOPE, GMAIL_SCOPE, emailConfiguration } from '../../email/config.js'

export class GoogleAuthError extends Error {
  readonly reason: 'exchange' | 'token' | 'nonce' | 'unverified' | 'domain'
  constructor(reason: GoogleAuthError['reason']) { super(reason); this.name = 'GoogleAuthError'; this.reason = reason }
}

export interface GoogleClaims { sub: string; email: string }
/** The token endpoint's answer. The access/refresh tokens matter only when Gmail was granted at sign-in (see mailAtSignIn). */
export interface GoogleTokens { idToken: string; accessToken?: string; refreshToken?: string; expiresIn?: number; scope?: string }
export interface GoogleGateway {
  /** Authorization code -> tokens (server-side, with the client secret and PKCE verifier). */
  exchangeCode(i: { code: string; verifier: string }): Promise<GoogleTokens>
  verifyIdToken(idToken: string, nonce: string): Promise<GoogleClaims>
}

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs')
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

/** Sign-in also connects the user's Gmail to Email Center (one consent, not two) when Email Center is set up on this same Google client. */
export function mailAtSignIn(): boolean {
  const mail = emailConfiguration()
  return mail.ready && mail.clientId === oauthConfig().clientId
}

export function buildAuthUrl(f: { state: string; nonce: string; challenge: string }): string {
  const cfg = oauthConfig()
  const url = new URL(AUTH_ENDPOINT)
  url.search = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code',
    scope: mailAtSignIn() ? `openid email profile ${GMAIL_SCOPE} ${CALENDAR_SCOPE}` : 'openid email profile',
    state: f.state, nonce: f.nonce, code_challenge: f.challenge, code_challenge_method: 'S256',
    hd: 'amnex.com', // a hint only: the @amnex.com check below is what enforces the domain
    prompt: 'select_account',
    // Offline access gives Email Center a refresh token so it keeps syncing after the sign-in session's Google token expires.
    ...(mailAtSignIn() && { access_type: 'offline', include_granted_scopes: 'true' }),
  }).toString()
  return url.toString()
}

/** Pure and key-injectable so every rule is unit-testable with locally generated keys. */
export async function verifyGoogleIdToken(
  idToken: string, nonce: string, deps: { clientId: string; keys: JWTVerifyGetKey; now?: Date },
): Promise<GoogleClaims> {
  let payload: Record<string, unknown>
  try {
    ;({ payload } = await jwtVerify(idToken, deps.keys, { issuer: ISSUERS, audience: deps.clientId, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub'], currentDate: deps.now }))
  } catch {
    throw new GoogleAuthError('token')
  }
  if (typeof payload.nonce !== 'string' || payload.nonce !== nonce) throw new GoogleAuthError('nonce')
  if (typeof payload.email !== 'string' || payload.email_verified !== true) throw new GoogleAuthError('unverified')
  const email = payload.email.trim().toLowerCase()
  if (!isAmnexAccount(email)) throw new GoogleAuthError('domain')
  if (typeof payload.sub !== 'string' || payload.sub === '') throw new GoogleAuthError('token')
  return { sub: payload.sub, email }
}

let jwks: JWTVerifyGetKey | undefined
const googleKeys: JWTVerifyGetKey = (header, token) => (jwks ??= createRemoteJWKSet(JWKS_URL))(header, token)

export const googleGateway: GoogleGateway = {
  async exchangeCode({ code, verifier }) {
    const cfg = oauthConfig()
    let res: Response
    try {
      res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri,
          grant_type: 'authorization_code', code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new GoogleAuthError('exchange')
    }
    if (!res.ok) throw new GoogleAuthError('exchange')
    const body = (await res.json().catch(() => null)) as { id_token?: unknown; access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown } | null
    if (typeof body?.id_token !== 'string') throw new GoogleAuthError('exchange')
    const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
    return { idToken: body.id_token, accessToken: text(body.access_token), refreshToken: text(body.refresh_token), scope: text(body.scope),
      expiresIn: typeof body.expires_in === 'number' ? body.expires_in : undefined }
  },
  verifyIdToken: (idToken, nonce) => verifyGoogleIdToken(idToken, nonce, { clientId: oauthConfig().clientId, keys: googleKeys }),
}
