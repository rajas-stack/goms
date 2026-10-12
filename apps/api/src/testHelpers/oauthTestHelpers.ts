import { randomUUID } from 'node:crypto'
import { pool } from '../db.js'
import { signAccessToken } from '../auth/oauth/accessToken.js'
import type { AuthProvider } from '../auth/oauth/config.js'
import { GoogleAuthError, type GoogleClaims, type GoogleGateway } from '../auth/oauth/googleClient.js'

export const TEST_SESSION_SECRET = 'test-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz'
const KEYS = ['AUTH_PROVIDER', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI', 'AUTH_SESSION_SECRET',
  'OAUTH_WEB_ORIGIN', 'AUTH_ACCESS_TTL_SECONDS', 'AUTH_REFRESH_TTL_DAYS', 'OAUTH_APP_SCHEME']

/** A complete, fake OAuth environment. Nothing here is a real credential. */
export function useOauthEnv(provider: AuthProvider = 'both'): void {
  process.env.AUTH_PROVIDER = provider
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client.apps.googleusercontent.com'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret'
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://goms.test/api/oauth/google/callback'
  process.env.AUTH_SESSION_SECRET = TEST_SESSION_SECRET
}
export function clearOauthEnv(): void { for (const k of KEYS) delete process.env[k] }

export async function cleanupOauthTables(): Promise<void> {
  await pool.query('DELETE FROM auth_sessions')
  await pool.query('DELETE FROM auth_exchange_codes')
  await pool.query('DELETE FROM auth_flows')
}

/** A tRPC context carrying a real GOMS access token for `email` (the OAuth analogue of contextForEmail). */
export async function gomsContextForEmail(email: string, uid = `g:${email}`): Promise<{ authHeader: string }> {
  const { token } = await signAccessToken({ uid, email: email.trim().toLowerCase(), familyId: randomUUID() })
  return { authHeader: `Bearer ${token}` }
}

/** A Google stand-in that records what the API sent it. `fail` makes the matching step reject like the real one would. */
export function fakeGoogle(over: { email?: string; sub?: string; fail?: GoogleAuthError['reason'] } = {}) {
  const calls = { exchange: [] as { code: string; verifier: string }[], verify: [] as { idToken: string; nonce: string }[] }
  const gateway: GoogleGateway = {
    async exchangeCode(i) {
      calls.exchange.push(i)
      if (over.fail === 'exchange') throw new GoogleAuthError('exchange')
      return `fake-id-token:${i.code}`
    },
    async verifyIdToken(idToken, nonce): Promise<GoogleClaims> {
      calls.verify.push({ idToken, nonce })
      if (over.fail && over.fail !== 'exchange') throw new GoogleAuthError(over.fail)
      return { sub: over.sub ?? '1234567890', email: (over.email ?? 'someone@amnex.com').toLowerCase() }
    },
  }
  return { gateway, calls }
}
