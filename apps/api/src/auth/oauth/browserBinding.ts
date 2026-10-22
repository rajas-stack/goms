import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyReply } from 'fastify'
import { emailConfiguration } from '../../email/config.js'
import { oauthConfig, sessionKey } from './config.js'

/**
 * Browser binding for the one-use Google OAuth artifacts: the login `state`, the web exchange code, and the Email Center / Profile Images
 * connection states. A leaked or injected artifact must be unusable from any browser other than the one that started the flow.
 *
 * WHY ONE COOKIE NAMED `__session`: firebase.json routes /api/** through a Firebase Hosting rewrite to Cloud Run, and Hosting forwards only
 * the specially named `__session` cookie to the backend (https://firebase.google.com/docs/hosting/manage-cache). Per-flow cookies such as
 * `goms_login_<hash>` never reach the API behind Hosting (observed on a real preview channel: of four cookies the browser sent, the backend
 * received only `__session`), so every sign-in failed with a state error. The Firebase CLI's emulator drops `Set-Cookie` from responses
 * without `private`; REAL Hosting was observed to pass it through, but every response that sets the cookie still goes through
 * sendBrowserCookie() (Cache-Control `private, no-store`) so no CDN layer can ever cache or share it.
 *
 * DESIGN. `__session` holds ONE opaque, integrity-protected random browser id, `<id>.<HMAC(id)>`, set once and reused by every flow, so
 * concurrent sign-in, Gmail and Profile Images flows share it with no read-modify-write of cookie state (no lost updates, no size limit).
 * The binding lives in the artifacts themselves:
 *   - login state and web exchange code are 43-character base64url tokens = 22 random characters + 21 characters of
 *     HMAC(key, purpose, random, browser id). The callback / exchange recompute it from the request's own cookie, so a token only
 *     verifies in the browser that holds the id it was minted for. The check runs BEFORE the one-use row is consumed, so a foreign
 *     browser cannot burn the legitimate flow.
 *   - Email Center / Profile Images keep their server-side `email_oauth_flows.cookie_hash` check; the value that is hashed is now
 *     derived (HMAC of purpose, state and browser id) instead of being stored in a per-flow cookie.
 * Replay prevention is unchanged and server-side: auth_flows rows and exchange codes are single use. The cookie is NOT a credential: no
 * endpoint authenticates with it (GOMS sessions are Bearer tokens), so it adds no CSRF surface. A forged or foreign `__session` fails its
 * HMAC and is replaced, never trusted.
 */
export const BROWSER_COOKIE = '__session'
export type TokenPurpose = 'login' | 'exchange'

const COOKIE_MAX_AGE_SECONDS = 3600
const TOKEN_RANDOM_CHARS = 22
const TOKEN_TAG_CHARS = 21
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/
const COOKIE_VALUE = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/

/** HKDF of AUTH_SESSION_SECRET (login deployments), else the Email Center encryption secret (Email Center without login). */
function key(): Buffer {
  let secret: string
  try { secret = Buffer.from(sessionKey()).toString('utf8') } catch (error) {
    const fallback = emailConfiguration().encryptionSecret
    if (Buffer.byteLength(fallback) < 32) throw error
    secret = fallback
  }
  return Buffer.from(hkdfSync('sha256', secret, 'goms-browser-binding', 'session-cookie-v2', 32))
}
const mac = (...parts: string[]) => createHmac('sha256', key()).update(parts.join(':')).digest('base64url')
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** The request's verified browser id, or null when the cookie is missing, duplicated, malformed or not signed by this server. */
export function browserId(cookieHeader: string | undefined): string | null {
  const matches = (cookieHeader ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${BROWSER_COOKIE}=`))
  if (matches.length !== 1) return null
  const value = matches[0].slice(BROWSER_COOKIE.length + 1)
  if (!COOKIE_VALUE.test(value)) return null
  const [id, tag] = value.split('.')
  return equal(tag, mac('goms-browser-id:v2', id)) ? id : null
}

/** The id new flows bind to (the caller's own, or a fresh one) plus the Set-Cookie that (re)issues it with a refreshed lifetime. */
export function ensureBrowser(cookieHeader: string | undefined, secure: boolean): { id: string; setCookie: string } {
  const id = browserId(cookieHeader) ?? randomBytes(32).toString('base64url')
  return { id, setCookie: `${BROWSER_COOKIE}=${id}.${mac('goms-browser-id:v2', id)}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure ? '; Secure' : ''}` }
}

/** A 43-character base64url token that only verifies for `id`. */
export function newBoundToken(purpose: TokenPurpose, id: string): string {
  const random = randomBytes(17).toString('base64url').slice(0, TOKEN_RANDOM_CHARS)
  return random + mac('goms-bound-token:v2', purpose, random, id).slice(0, TOKEN_TAG_CHARS)
}
export function tokenBoundTo(purpose: TokenPurpose, token: unknown, id: string | null): boolean {
  if (id === null || typeof token !== 'string' || !BASE64URL_43.test(token)) return false
  const random = token.slice(0, TOKEN_RANDOM_CHARS)
  return equal(token.slice(TOKEN_RANDOM_CHARS), mac('goms-bound-token:v2', purpose, random, id).slice(0, TOKEN_TAG_CHARS))
}

/** The secret whose hash the server stores in email_oauth_flows.cookie_hash for a mail / profile connection state. */
export function flowBinding(purpose: 'mail' | 'profile', state: string, id: string): string {
  return mac('goms-flow-binding:v2', purpose, state, id)
}

/** Sets the cookie with `Cache-Control: private, no-store`, so a cookie-setting response can never be cached or shared by a CDN layer. */
export function sendBrowserCookie(reply: FastifyReply, setCookie: string): void {
  reply.removeHeader('Set-Cookie')
  reply.header('Cache-Control', 'private, no-store').header('Set-Cookie', setCookie)
}

/** Login deployments mark the cookie Secure when the registered redirect URI is https (http is allowed for localhost only). */
export const loginCookieSecure = (): boolean => new URL(oauthConfig().redirectUri).protocol === 'https:'
