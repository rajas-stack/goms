import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { TRPCError } from '@trpc/server'

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
export interface EmailCredentials { accessToken: string; refreshToken: string; expiresAt: number }
export interface SealedEmailCredentials { version: 1; iv: string; tag: string; data: string }
/** Email Center and Profile Images (the Gmail and Drive connections) are OFF unless EMAIL_CENTER_ENABLED is exactly the text `true` (surrounding spaces ignored; unset,
 *  empty, `TRUE`, `1`, `yes`, `enabled` and everything else are off). It is independent of the sign-in variables: setting the Google client, the callback or a key never
 *  turns it on. When off, `emailConfiguration()` reports nothing usable and every entry point that starts a Google flow, opens or seals a stored credential, calls Gmail or
 *  Drive, or runs the Profile Images sync refuses before it touches the database or the network. */
export function emailCenterEnabled(env: NodeJS.ProcessEnv = process.env): boolean { return (env.EMAIL_CENTER_ENABLED ?? '').trim() === 'true' }
const OFF = { enabled: false, clientId: '', clientSecret: '', encryptionSecret: '', redirectUri: '', origin: '', ready: false } as const
export function emailConfiguration(env: NodeJS.ProcessEnv = process.env) {
  if (!emailCenterEnabled(env)) return OFF
  const clientId = env.EMAIL_GOOGLE_CLIENT_ID || env.GOOGLE_OAUTH_CLIENT_ID || ''
  const clientSecret = env.EMAIL_GOOGLE_CLIENT_SECRET || env.GOOGLE_OAUTH_CLIENT_SECRET || ''
  // The dedicated key only. It never falls back to AUTH_SESSION_SECRET: sealing Gmail and Drive credentials with the sign-in session secret would tie their lifetime to it.
  const encryptionSecret = env.EMAIL_TOKEN_ENCRYPTION_KEY || ''
  let redirectUri = env.EMAIL_GOOGLE_REDIRECT_URI || env.GOOGLE_OAUTH_REDIRECT_URI || ''
  let origin = ''; let valid = false
  try {
    const url = new URL(redirectUri)
    valid = (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
      && url.pathname === '/api/oauth/google/callback' && !url.search && !url.hash && !url.username && !url.password
    origin = url.origin; redirectUri = url.toString()
  } catch { /* Setup remains unavailable, with no secret values returned. */ }
  const ready = !!clientId && !!clientSecret && Buffer.byteLength(encryptionSecret) >= 32 && valid
  return { enabled: true as boolean, clientId, clientSecret, encryptionSecret, redirectUri, origin, ready }
}
export function requireEmailConfiguration() {
  const config = emailConfiguration()
  if (!config.enabled) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Email Center is not enabled on this server.' })
  if (!config.ready) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Email Center needs a server Google OAuth web client, its registered callback, and a server encryption key. See Email Center connection setup.' })
  return config
}
function key(secret: string) {
  if (Buffer.byteLength(secret) < 32) throw new Error('Email encryption key is not configured.')
  return Buffer.from(hkdfSync('sha256', secret, 'goms-email-center-v1', 'gmail-credentials-at-rest', 32))
}
export function sealEmailCredentials(value: EmailCredentials, binding: string, secret = requireEmailConfiguration().encryptionSecret): SealedEmailCredentials {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  cipher.setAAD(Buffer.from(binding))
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
}
export function openEmailCredentials(value: SealedEmailCredentials, binding: string, secret = requireEmailConfiguration().encryptionSecret): EmailCredentials {
  if (value.version !== 1) throw new Error('Unsupported email credentials.')
  const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(value.iv, 'base64'))
  decipher.setAAD(Buffer.from(binding)); decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
  const result = JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8'))
  if (typeof result.accessToken !== 'string' || typeof result.refreshToken !== 'string' || !Number.isFinite(result.expiresAt)) throw new Error('Invalid email credentials.')
  return result
}
