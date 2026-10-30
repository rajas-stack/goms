import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { FastifyReply } from 'fastify'
import { TRPCError } from '@trpc/server'
import { safeReturnTo, webRedirectUrl } from '../auth/oauth/redirect.js'
import { chosenWebOrigin } from '../auth/oauth/config.js'
import { CALENDAR_SCOPE, GMAIL_SCOPE, openEmailCredentials, requireEmailConfiguration, sealEmailCredentials } from './config.js'
import type { EmailActor } from './access.js'
import { emailEvent, inTransaction } from './store.js'
import { pool } from '../db.js'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const random = () => randomBytes(32).toString('base64url')
const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
export interface MailOAuthGateway { exchange(code: string, verifier: string): Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope: string; id_token: string }>; verify(token: string, nonce: string): Promise<{ email: string; sub: string }>; profile(token: string): Promise<string> }
export const mailOAuthGateway: MailOAuthGateway = {
  async exchange(code, verifier) {
    const cfg = requireEmailConfiguration()
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, code_verifier: verifier, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`Google authorization failed (HTTP ${response.status}).`)
    const value = await response.json() as any
    if (!value.access_token || !value.id_token || !value.scope || !Number.isFinite(value.expires_in)) throw new Error('Google returned an incomplete authorization.')
    return value
  },
  async verify(token, nonce) {
    const { payload } = await jwtVerify(token, keys, { audience: requireEmailConfiguration().clientId, issuer: ['https://accounts.google.com', 'accounts.google.com'], algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat'] })
    if (payload.nonce !== nonce || payload.email_verified !== true || payload.hd !== 'amnex.com' || typeof payload.email !== 'string' || !payload.email.toLowerCase().endsWith('@amnex.com') || !payload.sub) throw new Error('Use your approved company Google Workspace account.')
    return { email: payload.email.toLowerCase(), sub: payload.sub }
  },
  async profile(token) {
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`Gmail is unavailable for this account (HTTP ${response.status}). Check the Gmail API is enabled for this Google Cloud project.`)
    const profile = await response.json() as { emailAddress: string }
    return profile.emailAddress.toLowerCase()
  },
}
/** Stores (or refreshes) the user's own Gmail as their Email Center mailbox. Google sends a refresh token only on a fresh consent,
 *  so a later grant without one keeps the stored token. Shared by "Connect Gmail" and GOMS sign-in. */
export async function saveMailbox(grant: { uid: string; email: string; sub: string; accessToken: string; refreshToken?: string; expiresIn: number; scope: string }) {
  await inTransaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`email-connect:${grant.email}`])
    const current = (await db.query('SELECT * FROM email_mailboxes WHERE owner_email=$1 AND provider_email=$1 FOR UPDATE', [grant.email])).rows[0]
    const id = current?.id ?? randomUUID()
    const previous = !grant.refreshToken && current?.credentials ? openEmailCredentials(current.credentials, `${id}:${grant.email}`) : null
    const refreshToken = grant.refreshToken || previous?.refreshToken
    if (!refreshToken) throw new Error('Reconnect with offline access.')
    const sealed = sealEmailCredentials({ accessToken: grant.accessToken, refreshToken, expiresAt: Date.now() + Math.min(Math.max(grant.expiresIn, 0), 3600) * 1000 }, `${id}:${grant.email}`)
    await db.query(`INSERT INTO email_mailboxes(id,owner_uid,owner_email,provider_email,provider_subject,credentials,scopes,status) VALUES ($1,$2,$3,$3,$4,$5,$6,'connected')
      ON CONFLICT(owner_email,provider_email) DO UPDATE SET owner_uid=EXCLUDED.owner_uid,provider_subject=EXCLUDED.provider_subject,credentials=EXCLUDED.credentials,scopes=EXCLUDED.scopes,status='connected',credential_revision=gen_random_uuid(),last_error=NULL,next_sync_at=now(),sync_failures=0,updated_at=now()`, [id, grant.uid, grant.email, grant.sub, JSON.stringify(sealed), grant.scope.split(' ')])
    await emailEvent({ email: grant.email }, 'mailbox_connected', { mailboxId: id }, db)
  })
}
function cookieName(state: string) { return `goms_mail_${digest(state).slice(0, 16)}` }
function cookie(state: string, value: string, secure: boolean, expired = false) {
  return `${cookieName(state)}=${value}; HttpOnly; SameSite=Lax; Path=/api/oauth/google/callback; Max-Age=${expired ? 0 : 600}${secure ? '; Secure' : ''}`
}
export async function beginMailConnection(actor: EmailActor, returnTo: string, setCookie?: (value: string) => void, webOrigin?: string) {
  const cfg = requireEmailConfiguration()
  if (!setCookie) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Open Email Center in the browser to connect Gmail.' })
  const state = `mail.${random()}`; const verifier = random(); const nonce = random(); const browserBinding = random()
  await pool.query('DELETE FROM email_oauth_flows WHERE expires_at<now()')
  await pool.query(`INSERT INTO email_oauth_flows(state_hash,cookie_hash,verifier,nonce,user_uid,email,return_to,web_origin,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '10 minutes')`, [digest(state), digest(browserBinding), verifier, nonce, actor.uid, actor.email, safeReturnTo(returnTo), chosenWebOrigin(webOrigin, cfg.origin, cfg.origin)])
  setCookie(cookie(state, browserBinding, cfg.origin.startsWith('https:')))
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: `openid email ${GMAIL_SCOPE} ${CALENDAR_SCOPE}`, state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', include_granted_scopes: 'true', prompt: 'consent', login_hint: actor.email, hd: 'amnex.com' }).toString()
  return { url: url.toString() }
}
/** No Google token is ever returned to the frontend; state + a host-only HttpOnly cookie bind the callback. */
export async function completeMailConnection(req: { query?: any; headers: { cookie?: string } }, reply: FastifyReply, gateway: MailOAuthGateway = mailOAuthGateway) {
  const cfg = requireEmailConfiguration(); const state = req.query?.state
  reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
  if (typeof state !== 'string' || !/^mail\.[\w-]{43}$/.test(state)) return reply.code(400).send({ error: 'Invalid email connection.' })
  const binding = (req.headers.cookie ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName(state)}=`))?.split('=')[1] ?? ''
  const flow = (await pool.query('DELETE FROM email_oauth_flows WHERE state_hash=$1 AND cookie_hash=$2 AND expires_at>now() RETURNING *', [digest(state), digest(binding)])).rows[0]
  reply.header('Set-Cookie', cookie(state, '', cfg.origin.startsWith('https:'), true))
  if (!flow) return reply.code(400).send({ error: 'Email connection expired or does not belong to this browser. Start again.' })
  const redirect = (status: string) => reply.code(302).header('Location', webRedirectUrl(flow.web_origin ?? cfg.origin, flow.return_to, { email_connection: status })).send()
  if (req.query?.error) return redirect('cancelled')
  if (typeof req.query?.code !== 'string' || req.query.code.length > 2048) return redirect('failed')
  try {
    const credentials = await gateway.exchange(req.query.code, flow.verifier)
    const claims = await gateway.verify(credentials.id_token, flow.nonce)
    if (claims.email !== flow.email || await gateway.profile(credentials.access_token) !== flow.email || !credentials.scope.split(' ').includes(GMAIL_SCOPE)) {
      console.warn(JSON.stringify({ event: 'email.connection_rejected', reason: claims.email !== flow.email ? 'different_account' : !credentials.scope.split(' ').includes(GMAIL_SCOPE) ? 'gmail_scope_not_granted' : 'profile_mismatch' }))
      return redirect('wrong_account_or_permission')
    }
    await saveMailbox({ uid: flow.user_uid, email: flow.email, sub: claims.sub, accessToken: credentials.access_token, refreshToken: credentials.refresh_token, expiresIn: credentials.expires_in, scope: credentials.scope })
    return redirect('connected')
  } catch (e) {
    // Keep known setup diagnostics; never log arbitrary provider, parser or database error content.
    const detail = e instanceof Error ? e.message : ''
    const safe = /^(?:Google authorization failed \(HTTP [1-5]\d{2}\)\.|Gmail is unavailable for this account \(HTTP [1-5]\d{2}\)\. Check the Gmail API is enabled for this Google Cloud project\.|Google returned an incomplete authorization\.|Use your approved company Google Workspace account\.|Reconnect with offline access\.)$/.test(detail)
    console.warn(JSON.stringify({ event: 'email.connection_failed', reason: safe ? detail : 'unexpected_failure' })); return redirect('failed')
  }
}
