import { randomBytes } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { parseMailParticipants, type EmailAttachment, type EmailCompose, type EmailConversation, type EmailMessage, type EmailSummary, type EmailUpload, EMAIL_ATTACHMENT_LIMIT_BYTES } from '@goms/domain'
import { pool } from '../db.js'
import { GMAIL_SCOPE, openEmailCredentials, requireEmailConfiguration, sealEmailCredentials } from './config.js'
import { inTransaction, type MailboxRow } from './store.js'

export class GmailFailure extends Error {
  constructor(readonly status: number) { super(status === 404 ? 'This email is unavailable or was deleted in Gmail.' : status === 429 ? 'Gmail is temporarily rate limiting requests. Retry shortly.' : status === 401 || status === 403 ? 'Reconnect Gmail or check the granted Google Workspace permissions.' : 'Gmail is temporarily unavailable. Retry without resending an uncertain message.'); this.name = 'GmailFailure' }
}
async function accessToken(mailbox: MailboxRow, force = false): Promise<string> {
  return inTransaction(async db => {
    const row = (await db.query('SELECT * FROM email_mailboxes WHERE id=$1 FOR UPDATE', [mailbox.id])).rows[0] as MailboxRow | undefined
    if (!row || row.status !== 'connected' || !row.credentials || row.credential_revision !== mailbox.credential_revision) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This mailbox was disconnected or changed. Reconnect and retry.' })
    const credentials = openEmailCredentials(row.credentials, `${row.id}:${row.owner_email}`)
    if (!force && credentials.expiresAt > Date.now() + 60_000) return credentials.accessToken
    const cfg = requireEmailConfiguration()
    let response: Response
    try { response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: credentials.refreshToken, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(15_000) }) }
    catch { throw new GmailFailure(503) }
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        await db.query("UPDATE email_mailboxes SET status='reconnect',credentials=NULL,last_error='Google authorization expired or was revoked.',credential_revision=gen_random_uuid(),updated_at=now() WHERE id=$1", [row.id])
        // Commit the revocation; throwing inside the transaction would roll it back.
        return ''
      }
      throw new GmailFailure(response.status)
    }
    const token = await response.json() as { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string }
    if (!token.access_token || !Number.isFinite(token.expires_in) || token.scope && !token.scope.split(' ').includes(GMAIL_SCOPE)) return ''
    const sealed = sealEmailCredentials({ accessToken: token.access_token, refreshToken: token.refresh_token || credentials.refreshToken, expiresAt: Date.now() + Math.min(token.expires_in!, 3600) * 1000 }, `${row.id}:${row.owner_email}`)
    await db.query('UPDATE email_mailboxes SET credentials=$2,updated_at=now() WHERE id=$1', [row.id, JSON.stringify(sealed)])
    return token.access_token
  }).then(token => { if (!token) throw new GmailFailure(401); return token })
}

export interface GmailPayload { mimeType?: string; filename?: string; partId?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPayload[] }
export interface GmailMessage { id: string; threadId: string; internalDate?: string; labelIds?: string[]; snippet?: string; payload?: GmailPayload }
const header = (message: GmailMessage, name: string) => message.payload?.headers?.find(value => value.name.toLowerCase() === name.toLowerCase())?.value ?? ''
export function gmailMessage(message: GmailMessage): EmailMessage {
  const attachments: EmailAttachment[] = []; const plain: string[] = []; const html: string[] = []
  function visit(part: GmailPayload, depth = 0) {
    if (depth > 30) return
    if (part.filename || part.body?.attachmentId && part.mimeType !== 'text/plain' && part.mimeType !== 'text/html') {
      attachments.push({ id: part.body?.attachmentId ?? '', partId: part.partId ?? '', messageId: message.id, name: (part.filename || 'attachment').slice(0, 260), mimeType: part.mimeType || 'application/octet-stream', size: part.body?.size ?? 0 })
    } else if (part.body?.data && part.body.data.length <= 2_000_000) {
      const text = Buffer.from(part.body.data, 'base64url').toString('utf8')
      if (part.mimeType === 'text/plain') plain.push(text)
      else if (part.mimeType === 'text/html') html.push(text)
    }
    for (const child of part.parts ?? []) visit(child, depth + 1)
  }
  if (message.payload) visit(message.payload)
  // Rendered as React text, never innerHTML. HTML-only mail is converted to text; remote images are never loaded.
  const text = plain.length ? plain.join('\n') : html.join('\n').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<(br|\/p|\/div)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  const date = new Date(Number(message.internalDate))
  if (!Number.isFinite(date.getTime())) throw new GmailFailure(502)
  const internetId = header(message, 'Message-ID').trim()
  return { id: message.id, threadId: message.threadId, subject: header(message, 'Subject').slice(0, 1000) || '(No subject)', date: date.toISOString(), from: parseMailParticipants(header(message, 'From')), to: parseMailParticipants(header(message, 'To')), cc: parseMailParticipants(header(message, 'Cc')), bcc: parseMailParticipants(header(message, 'Bcc')), replyTo: parseMailParticipants(header(message, 'Reply-To')), internetId: /^<[^<>\s]+>$/.test(internetId) ? internetId : '', references: header(message, 'References').replace(/[\r\n]/g, '').slice(0, 8000), text: text.slice(0, 1_000_000), snippet: (message.snippet ?? '').slice(0, 1000), labels: message.labelIds ?? [], attachments }
}
export function gmailSummary(messages: EmailMessage[], draftId?: string): EmailSummary {
  const latest = messages[messages.length - 1]
  if (!latest) throw new GmailFailure(404)
  return { id: latest.id, threadId: latest.threadId, subject: messages[0].subject, date: latest.date, from: latest.from, participants: [...new Map(messages.flatMap(message => [...message.from, ...message.to, ...message.cc]).map(person => [person.email, person])).values()], snippet: latest.snippet, labels: [...new Set(messages.flatMap(message => message.labels))], messageCount: messages.length, ...(draftId ? { draftId } : {}) }
}
export function gmailFor(mailbox: MailboxRow) {
  let token: Promise<string> | undefined
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!/^(messages|threads|drafts|labels|profile|settings\/sendAs)([/?]|$)/.test(path) || path.includes('://')) throw new Error('Invalid Gmail operation.')
    const read = async (bearer: string) => fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { method, headers: { Authorization: `Bearer ${bearer}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(25_000) })
    let response: Response
    try { response = await read(await (token ??= accessToken(mailbox))) }
    catch (error) { if (error instanceof TRPCError || error instanceof GmailFailure) throw error; throw new GmailFailure(503) }
    if (response.status === 401 && method === 'GET') response = await read(await (token = accessToken(mailbox, true)))
    if (!response.ok) throw new GmailFailure(response.status)
    return response.status === 204 ? undefined as T : response.json() as Promise<T>
  }
  /** Large messages go through Gmail's upload endpoint (multipart: JSON metadata + the RFC 822 message, up to 35 MB). */
  async function upload<T>(path: 'messages/send' | 'drafts' | `drafts/${string}`, method: 'POST' | 'PUT', metadata: Record<string, unknown>, raw: string): Promise<T> {
    const boundary = `goms_upload_${randomBytes(12).toString('hex')}`
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`),
      Buffer.from(raw, 'base64url'), Buffer.from(`\r\n--${boundary}--`),
    ])
    const send = async (bearer: string) => fetch(`https://gmail.googleapis.com/upload/gmail/v1/users/me/${path}?uploadType=multipart`, { method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body, redirect: 'error', signal: AbortSignal.timeout(120_000) })
    let response: Response
    try { response = await send(await (token ??= accessToken(mailbox))) }
    catch (error) { if (error instanceof TRPCError || error instanceof GmailFailure) throw error; throw new GmailFailure(503) }
    if (!response.ok) throw new GmailFailure(response.status)
    return response.json() as Promise<T>
  }
  async function message(id: string, metadata = false) {
    const value = await request<GmailMessage>(`messages/${encodeURIComponent(id)}?format=${metadata ? 'metadata' : 'full'}`)
    return gmailMessage(value)
  }
  async function thread(id: string, metadata = false): Promise<EmailConversation> {
    const value = await request<{ id: string; messages?: GmailMessage[] }>(`threads/${encodeURIComponent(id)}?format=${metadata ? 'metadata' : 'full'}`)
    const messages = (value.messages ?? []).map(gmailMessage).sort((a, b) => a.date.localeCompare(b.date))
    if (!messages.length) throw new GmailFailure(404)
    return { id: value.id, subject: messages[0].subject, messages }
  }
  return { request, upload, message, thread,
    async conversation(kind: 'message' | 'thread', id: string, metadata = false): Promise<EmailConversation> {
      if (kind === 'thread') return thread(id, metadata)
      const value = await message(id, metadata); return { id: value.threadId, subject: value.subject, messages: [value] }
    },
    async identities() {
      const result = await request<{ sendAs?: { sendAsEmail: string; displayName?: string; isPrimary?: boolean; verificationStatus?: string }[] }>('settings/sendAs')
      return (result.sendAs ?? []).filter(value => value.isPrimary || value.verificationStatus === 'accepted').map(value => ({ email: value.sendAsEmail.toLowerCase(), name: value.displayName ?? '', primary: !!value.isPrimary }))
    },
    async attachment(messageId: string, descriptor: EmailAttachment, original?: GmailMessage) {
      if (descriptor.size > 25 * 1024 * 1024) throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'This attachment exceeds the 25 MB download limit. Open it in Gmail.' })
      if (descriptor.id) return request<{ data: string; size: number }>(`messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(descriptor.id)}`)
      const raw = original ?? await request<GmailMessage>(`messages/${encodeURIComponent(messageId)}?format=full`)
      function find(part?: GmailPayload): GmailPayload | undefined { if (part?.partId === descriptor.partId && part.filename) return part; for (const child of part?.parts ?? []) { const found = find(child); if (found) return found } }
      const part = find(raw.payload)
      if (!part?.body?.data) throw new GmailFailure(404)
      return { data: part.body.data, size: part.body.size ?? 0 }
    },
  }
}
const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? ''
const mimeType = (value: string) => /^[\w.+-]+\/[\w.+-]+$/.test(value) ? value : 'application/octet-stream'
export function buildEmailMime(input: EmailCompose, reply?: { message: EmailMessage; sameMailbox: boolean }, forwarded: EmailUpload[] = []) {
  if ([input.from, input.subject, ...input.to, ...input.cc, ...input.bcc].some(value => /[\r\n]/.test(value))) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Email headers must be a single line.' })
  const attachments = [...input.attachments, ...forwarded]
  let total = 0
  for (const attachment of attachments) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.data)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'An attachment contains invalid file data.' })
    total += Buffer.from(attachment.data, 'base64').length
  }
  if (total > EMAIL_ATTACHMENT_LIMIT_BYTES) throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Attachments may total up to 25 MB (Gmail limit). Share larger files as a link.' })
  const boundary = `goms_${randomBytes(18).toString('hex')}`
  const headers = [`From: ${input.from}`, `To: ${input.to.join(', ')}`, ...(input.cc.length ? [`Cc: ${input.cc.join(', ')}`] : []), ...(input.bcc.length ? [`Bcc: ${input.bcc.join(', ')}`] : []), `Subject: =?UTF-8?B?${Buffer.from(input.subject).toString('base64')}?=`, 'MIME-Version: 1.0']
  if (reply && input.reply?.mode !== 'forward' && /^<[^<>\s]+>$/.test(reply.message.internetId)) {
    headers.push(`In-Reply-To: ${reply.message.internetId}`)
    const references = [...new Set([...(reply.message.references.match(/<[^<>\s]+>/g) ?? []), reply.message.internetId])].slice(-20).join(' ')
    headers.push(`References: ${references}`)
  }
  const text = `Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(input.text)}`
  let content: string
  if (!attachments.length) content = [...headers, text].join('\r\n')
  else {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
    content = `${headers.join('\r\n')}\r\n\r\n--${boundary}\r\n${text}`
    for (const attachment of attachments) content += `\r\n--${boundary}\r\nContent-Type: ${mimeType(attachment.mimeType)}\r\nContent-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${attachment.data.match(/.{1,76}/g)?.join('\r\n') ?? ''}`
    content += `\r\n--${boundary}--\r\n`
  }
  return { raw: Buffer.from(content).toString('base64url'), ...(reply?.sameMailbox && input.reply?.mode !== 'forward' ? { threadId: reply.message.threadId } : {}) }
}
