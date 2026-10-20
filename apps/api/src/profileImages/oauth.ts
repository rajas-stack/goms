import { createHash, randomBytes } from 'node:crypto'
import type { FastifyReply } from 'fastify'
import { TRPCError } from '@trpc/server'
import { pool } from '../db.js'
import { mailOAuthGateway, type MailOAuthGateway } from '../email/oauth.js'
import { emailConfiguration, openEmailCredentials, sealEmailCredentials } from '../email/config.js'
import { isSystemAdminEmail } from '../auth/rbac/systemAdminOnly.js'
import { clearProfileByteCache, PROFILE_CREDENTIAL_BINDING, withProfileLock, writeProfileState, syncProfileImages } from './service.js'
import { assertProfileAccess } from './access.js'

export const PROFILE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const random = () => randomBytes(32).toString('base64url')
const cookieName = (state: string) => `goms_profile_${digest(state).slice(0, 16)}`
const cookie = (state: string, value: string, expired = false) => `${cookieName(state)}=${value}; HttpOnly; SameSite=Lax; Path=/api/oauth/google/callback; Max-Age=${expired ? 0 : 600}${emailConfiguration().origin.startsWith('https:') ? '; Secure' : ''}`
export async function beginProfileConnection(user: { uid: string; email: string }, setCookie?: (value: string) => void) {
  const cfg = emailConfiguration()
  if (!cfg.ready) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Configure the existing server Google OAuth client, callback, and encryption key before connecting Profile Images.' })
  if (!setCookie) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Open DMS in a browser to connect.' })
  const state = `profile.${random()}`; const verifier = random(); const nonce = random(); const binding = random()
  // Reuse the existing expiring, single-use Google OAuth flow store, with a separate state/cookie namespace.
  await pool.query('DELETE FROM email_oauth_flows WHERE expires_at<now()')
  await pool.query(`INSERT INTO email_oauth_flows(state_hash,cookie_hash,verifier,nonce,user_uid,email,return_to,expires_at) VALUES($1,$2,$3,$4,$5,$6,'/settings/dms',now()+interval '10 minutes')`, [digest(state), digest(binding), verifier, nonce, user.uid, user.email.toLowerCase()])
  setCookie(cookie(state, binding))
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: `openid email ${PROFILE_DRIVE_SCOPE}`, state, nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', login_hint: user.email, hd: 'amnex.com' }).toString()
  return { url: url.toString() }
}
export async function completeProfileConnection(req: { query?: any; headers: { cookie?: string } }, reply: FastifyReply, gateway: MailOAuthGateway = mailOAuthGateway) {
  const state = req.query?.state
  reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
  if (typeof state !== 'string' || !/^profile\.[\w-]{43}$/.test(state)) return reply.code(400).send({ error: 'Invalid Profile Images connection.' })
  const binding = (req.headers.cookie ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName(state)}=`))?.split('=')[1] ?? ''
  const flow = (await pool.query('DELETE FROM email_oauth_flows WHERE state_hash=$1 AND cookie_hash=$2 AND expires_at>now() RETURNING *', [digest(state), digest(binding)])).rows[0]
  reply.header('Set-Cookie', cookie(state, '', true))
  if (!flow) return reply.code(400).send({ error: 'Connection expired or does not belong to this browser. Connect again from DMS.' })
  const redirect = (result: string) => reply.code(302).header('Location', `${emailConfiguration().origin}/settings/dms?profile_connection=${result}`).send()
  if (req.query?.error) return redirect('cancelled')
  if (typeof req.query?.code !== 'string' || req.query.code.length > 2048) return redirect('failed')
  try {
    const credentials = await gateway.exchange(req.query.code, flow.verifier)
    const claims = await gateway.verify(credentials.id_token, flow.nonce)
    if (claims.email !== flow.email || !isSystemAdminEmail(claims.email) || !credentials.scope.split(' ').includes(PROFILE_DRIVE_SCOPE)) return redirect('wrong_account_or_permission')
    await assertProfileAccess(claims, true, true)
    await withProfileLock(async (current, db) => {
      const previous = !credentials.refresh_token && current.accountEmail === claims.email && current.credentials ? openEmailCredentials(current.credentials, PROFILE_CREDENTIAL_BINDING) : null
      const refreshToken = credentials.refresh_token || previous?.refreshToken
      if (!refreshToken) throw new Error('Offline access is required.')
      current.credentials = sealEmailCredentials({ accessToken: credentials.access_token, refreshToken, expiresAt: Date.now() + Math.min(Math.max(credentials.expires_in, 0), 3600) * 1000 }, PROFILE_CREDENTIAL_BINDING)
      current.accountEmail = claims.email; current.error = null
      current.pageToken = undefined; current.files = []; current.mappings = {}; current.lastSyncAt = null
      clearProfileByteCache(); await writeProfileState(db, current)
    })
    await syncProfileImages()
    return redirect('connected')
  } catch { return redirect('failed') }
}
