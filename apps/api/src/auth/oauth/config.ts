export type AuthProvider = 'firebase' | 'both' | 'oauth'

/** Read on every call so tests (and an env-only Cloud Run revision) take effect without a restart of module state. */
export function authProvider(): AuthProvider {
  const raw = (process.env.AUTH_PROVIDER ?? 'firebase').trim().toLowerCase()
  if (raw === 'both' || raw === 'oauth') return raw
  if (raw !== '' && raw !== 'firebase') console.warn(JSON.stringify({ event: 'auth.invalid_provider', using: 'firebase' }))
  return 'firebase'
}
export const oauthEnabled = (): boolean => authProvider() !== 'firebase'
export const gomsAccepted = (): boolean => authProvider() !== 'firebase'
export const firebaseAccepted = (): boolean => authProvider() !== 'oauth'

export class OAuthConfigError extends Error {}

/** The deep-link scheme this API deployment hands the Android app (thin-shell design §6.4). A fixed allow-list: the dev API sets
 *  `com.gorms.app.dev`, prod leaves it unset. Anything else is a configuration error, never passed through. */
export const APP_SCHEMES = ['com.gorms.app', 'com.gorms.app.dev'] as const
export function appScheme(): (typeof APP_SCHEMES)[number] {
  const raw = (process.env.OAUTH_APP_SCHEME ?? '').trim()
  if (raw === '') return 'com.gorms.app'
  if ((APP_SCHEMES as readonly string[]).includes(raw)) return raw as (typeof APP_SCHEMES)[number]
  throw new OAuthConfigError('OAUTH_APP_SCHEME is not an allowed value')
}

/** HS256 signing key. Needed to verify GOMS tokens in `both`/`oauth`, so it does not require the Google credentials. */
export function sessionKey(): Uint8Array {
  const raw = process.env.AUTH_SESSION_SECRET ?? ''
  if (Buffer.byteLength(raw) < 32) throw new OAuthConfigError('AUTH_SESSION_SECRET must be at least 32 bytes')
  return new TextEncoder().encode(raw)
}

export interface OAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Where the web callback sends the browser back to (default: the redirect URI's own origin). */
  webOrigin: string
  accessTtlSeconds: number
  refreshTtlDays: number
}

/** The ONE place a numeric TTL setting is parsed (access seconds, refresh days). It floors FIRST and only then requires > 0, so a
 *  fractional value below 1 (`0.5`) falls back to the default instead of flooring to 0 and expiring every token the instant it is issued.
 *  Zero, negatives, NaN, Infinity and anything non-numeric also fall back to the default. */
export function ttlSetting(raw: string | undefined, fallback: number): number {
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n > 0 ? n : fallback
}
/** Read on every call, like the rest of this module. Neither needs the Google credentials. */
export const accessTtlSeconds = (): number => ttlSetting(process.env.AUTH_ACCESS_TTL_SECONDS, 900)
export const refreshTtlDays = (): number => ttlSetting(process.env.AUTH_REFRESH_TTL_DAYS, 30)

export function oauthConfig(): OAuthConfig {
  const required = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI', 'AUTH_SESSION_SECRET']
  const missing = required.filter((name) => !process.env[name]?.trim())
  if (missing.length > 0) throw new OAuthConfigError(`Missing configuration: ${missing.join(', ')}`)
  sessionKey()

  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI!.trim()
  let redirect: URL
  try { redirect = new URL(redirectUri) } catch { throw new OAuthConfigError('GOOGLE_OAUTH_REDIRECT_URI is not a URL') }
  const local = redirect.hostname === 'localhost' || redirect.hostname === '127.0.0.1'
  if (redirect.protocol !== 'https:' && !(local && redirect.protocol === 'http:')) {
    throw new OAuthConfigError('GOOGLE_OAUTH_REDIRECT_URI must be https (http only for localhost)')
  }
  if (redirect.pathname !== '/api/oauth/google/callback' || redirect.search || redirect.hash) {
    throw new OAuthConfigError('GOOGLE_OAUTH_REDIRECT_URI must be exactly <origin>/api/oauth/google/callback')
  }

  const cors = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  const allowedWebOrigins = new Set([redirect.origin, 'http://localhost:5173', ...cors])
  const webOrigin = (process.env.OAUTH_WEB_ORIGIN?.trim() || redirect.origin).replace(/\/$/, '')
  if (!allowedWebOrigins.has(webOrigin)) throw new OAuthConfigError('OAUTH_WEB_ORIGIN is not an allowed origin')

  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!.trim(),
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    redirectUri,
    webOrigin,
    accessTtlSeconds: accessTtlSeconds(),
    refreshTtlDays: refreshTtlDays(),
  }
}
