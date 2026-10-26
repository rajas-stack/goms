import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { oauthConfig, sessionKey } from './config.js'

type Purpose = 'login' | 'exchange'
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
const secure = () => new URL(oauthConfig().redirectUri).protocol === 'https:'
function name(purpose: Purpose, token: string) {
  return `${secure() ? '__Host-' : ''}goms_${purpose}_${createHash('sha256').update(token).digest('hex').slice(0, 16)}`
}
function signature(purpose: Purpose, token: string) {
  return createHmac('sha256', sessionKey()).update(`goms-browser-binding:${purpose}:${token}`).digest('base64url')
}

/** A host-only HttpOnly cookie binds each one-use authorization artifact to its initiating browser. */
export function browserBindingCookie(purpose: Purpose, token: string, expired = false): string {
  if (!validToken(token)) throw new Error('Invalid browser binding token')
  return `${name(purpose, token)}=${expired ? '' : signature(purpose, token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${expired ? 0 : 600}${secure() ? '; Secure' : ''}`
}

export function hasBrowserBinding(purpose: Purpose, token: unknown, cookies: string | undefined): boolean {
  if (!validToken(token)) return false
  const prefix = `${name(purpose, token)}=`
  const matches = (cookies ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(prefix))
  if (matches.length !== 1) return false
  const value = matches[0].slice(prefix.length)
  if (!validToken(value)) return false
  return timingSafeEqual(Buffer.from(value), Buffer.from(signature(purpose, token)))
}
