import { TRPCError } from '@trpc/server'
import { EMAIL_ACTIONS, type EmailEntityRef, type EmailItemRef, type EmailLink, type EmailMailbox, type EmailMessage, type EmailSummary } from '@goms/domain'
import { pool } from '../db.js'
import { assertEmailAction, assertEmailEntity, deniedEmailRecord, emailActionAllowed, managesEmailOwner, refreshEmailActor, visibleEmailEntity, type EmailActor } from './access.js'
import { isSystemAdminEmail } from '../auth/rbac/systemAdminOnly.js'
import { emailEvent, inTransaction, loadEmailMailbox, type MailboxRow } from './store.js'
import { gmailFor, GmailFailure, gmailSummary } from './gmail.js'

export const ownMailbox = (actor: EmailActor, mailbox: MailboxRow) => actor.email === mailbox.owner_email
export async function applicableEmailGrant(actor: EmailActor, mailbox: MailboxRow, entity?: EmailEntityRef, download = false) {
  assertEmailAction(actor, 'supervisor')
  const { rows } = await pool.query(`SELECT * FROM email_access_grants WHERE mailbox_id=$1 AND grantee=$2 AND status='approved' AND expires_at>now()
    AND (entity_type IS NULL OR (entity_type=$3 AND entity_id=$4)) ORDER BY created_at DESC`, [mailbox.id, actor.email, entity?.type ?? null, entity?.id ?? null])
  for (const grant of rows) {
    if (download && !grant.allow_download) continue
    if (grant.kind === 'superadmin' && !isSystemAdminEmail(actor.email)) continue
    if (grant.kind === 'hod' && !await managesEmailOwner(actor.email, mailbox.owner_email)) continue
    return grant
  }
  throw deniedEmailRecord()
}
export async function authorizeEmailMailbox(actor: EmailActor, mailboxId: string, options: { action?: 'view' | 'send' | 'download' | 'link' | 'unlink' | 'share'; entity?: EmailEntityRef; supervisor?: boolean; allowUnlinked?: boolean } = {}) {
  assertEmailAction(actor, options.action ?? 'view')
  if (options.entity) await assertEmailEntity(actor, options.entity)
  const mailbox = await loadEmailMailbox(mailboxId)
  if (!mailbox) throw deniedEmailRecord()
  if (!ownMailbox(actor, mailbox)) {
    if (!options.supervisor || ['send', 'link', 'unlink', 'share'].includes(options.action ?? 'view')) throw deniedEmailRecord()
    const grant = await applicableEmailGrant(actor, mailbox, options.entity, options.action === 'download')
    if (options.allowUnlinked && !grant.include_unlinked) throw deniedEmailRecord()
    await emailEvent(actor, 'supervisory_access', { mailboxId, entity: options.entity, grantId: grant.id, details: { action: options.action ?? 'view', unlinked: !!options.allowUnlinked } })
  }
  if (mailbox.status !== 'connected' || !mailbox.credentials) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This mailbox is disconnected or requires Google authorization. Reconnect Gmail.' })
  return mailbox
}
export async function recheckEmailAccess(actor: EmailActor, mailbox: MailboxRow, options: Parameters<typeof authorizeEmailMailbox>[2] = {}) {
  const current = await refreshEmailActor(actor)
  const next = await authorizeEmailMailbox(current, mailbox.id, options)
  if (next.credential_revision !== mailbox.credential_revision) throw deniedEmailRecord()
  return current
}
export function emailMailboxDto(actor: EmailActor, row: MailboxRow, supervisor = false): EmailMailbox {
  const own = ownMailbox(actor, row)
  return { id: row.id, email: row.provider_email, ownerEmail: row.owner_email, status: row.status, own, supervisor,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null, lastError: row.last_error,
    capabilities: EMAIL_ACTIONS.filter(action => emailActionAllowed(actor, action) && (own || ['view', 'download', 'supervisor'].includes(action))) }
}
export async function indexEmailLink(row: any, messages: EmailMessage[]) {
  await inTransaction(async db => {
    for (const message of messages) await db.query(`INSERT INTO email_link_messages(link_id,provider_message_id,internet_id,sent_at) VALUES ($1,$2,$3,$4)
      ON CONFLICT(link_id,provider_message_id) DO UPDATE SET internet_id=EXCLUDED.internet_id,sent_at=EXCLUDED.sent_at`, [row.id, message.id, message.internetId, message.date])
    await db.query("UPDATE email_links SET availability='available' WHERE id=$1 AND removed_at IS NULL", [row.id])
  })
}
async function linkDto(actor: EmailActor, row: any, override?: EmailItemRef): Promise<EmailLink | null> {
  const entity = await visibleEmailEntity(actor, { type: row.entity_type, id: row.entity_id })
  if (!entity) return null
  return { id: row.id, item: override ?? { mailboxId: row.mailbox_id, kind: row.item_kind, id: row.item_id }, entity, participantVisible: row.participant_visible,
    createdAt: new Date(row.created_at).toISOString(), own: row.owner_email === actor.email, availability: row.availability, category: row.category, ...(override ? { copy: true } : {}) }
}
export async function authorizedEmailRelationships(actor: EmailActor, mailbox: MailboxRow, item: EmailItemRef, messages: EmailMessage[]) {
  const ids = messages.map(value => value.id); const internetIds = messages.map(value => value.internetId).filter(Boolean)
  const { rows } = await pool.query(`SELECT DISTINCT l.*,m.owner_email,r.internet_id FROM email_links l JOIN email_mailboxes m ON m.id=l.mailbox_id LEFT JOIN email_link_messages r ON r.link_id=l.id
    WHERE l.removed_at IS NULL AND ((l.mailbox_id=$1 AND ((l.item_kind=$2 AND l.item_id=$3) OR l.item_kind='message' AND l.item_id=ANY($4::text[]) OR l.item_kind='thread' AND l.item_id=ANY($5::text[])))
    OR l.participant_visible AND r.internet_id<>'' AND r.internet_id=ANY($6::text[])) ORDER BY l.created_at DESC`, [mailbox.id, item.kind, item.id, ids, messages.map(value => value.threadId), internetIds])
  const result: EmailLink[] = []
  for (const row of rows) {
    // Only this mailbox's provider copy is represented. The source owner's mailbox and Bcc identity never leave the server.
    const ownMessage = messages.find(message => message.internetId && message.internetId === row.internet_id)
    const override = row.mailbox_id === mailbox.id ? undefined : row.item_kind === 'message' && ownMessage ? { ...item, kind: 'message' as const, id: ownMessage.id } : item
    const value = await linkDto(actor, row, override)
    if (value && !result.some(existing => existing.id === value.id && existing.item.id === value.item.id && existing.item.kind === value.item.kind)) result.push(value)
  }
  return result
}
export async function assertContextCorrespondence(actor: EmailActor, mailbox: MailboxRow, item: EmailItemRef, messages: EmailMessage[], entity: EmailEntityRef) {
  const links = await authorizedEmailRelationships(actor, mailbox, item, messages)
  if (!links.some(link => link.entity.type === entity.type && link.entity.id === entity.id && (item.kind === 'message' || link.item.kind === 'thread'))) throw deniedEmailRecord()
}
export interface ContextEmailRow { link: EmailLink; summary: EmailSummary | null; mailboxEmail: string; ownerEmail: string; error?: string }
export async function contextEmails(actor: EmailActor, entity: EmailEntityRef, mailboxIds: string[], supervisor = false, cursor = 0) {
  await assertEmailEntity(actor, entity)
  const ownRows = (await pool.query(`SELECT l.*,m.owner_email,m.provider_email FROM email_links l JOIN email_mailboxes m ON m.id=l.mailbox_id
    WHERE l.entity_type=$1 AND l.entity_id=$2 AND l.removed_at IS NULL AND l.mailbox_id=ANY($3::uuid[]) ORDER BY l.created_at DESC,l.id LIMIT 21 OFFSET $4`, [entity.type, entity.id, mailboxIds, cursor])).rows
  const rows: ContextEmailRow[] = []
  const clients = new Map<string, { mailbox: MailboxRow; gmail: ReturnType<typeof gmailFor> }>()
  for (const row of ownRows.slice(0, 20)) {
    let link: EmailLink | null = null
    try {
      const mailbox = await authorizeEmailMailbox(actor, row.mailbox_id, { entity, supervisor })
      const client = clients.get(mailbox.id) ?? { mailbox, gmail: gmailFor(mailbox) }; clients.set(mailbox.id, client)
      link = await linkDto(actor, row)
      if (!link) continue
      const conversation = await client.gmail.conversation(row.item_kind, row.item_id)
      if (ownMailbox(actor, mailbox)) await indexEmailLink(row, conversation.messages)
      await recheckEmailAccess(actor, mailbox, { entity, supervisor })
      rows.push({ link, summary: gmailSummary(conversation.messages), mailboxEmail: mailbox.provider_email, ownerEmail: mailbox.owner_email })
    } catch (error) {
      if (error instanceof TRPCError && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) continue
      if (error instanceof GmailFailure && error.status === 404) await pool.query("UPDATE email_links SET availability='deleted' WHERE id=$1", [row.id])
      if (link) rows.push({ link: { ...link, availability: error instanceof GmailFailure && error.status === 404 ? 'deleted' : 'unavailable' }, summary: null, mailboxEmail: row.provider_email, ownerEmail: row.owner_email, error: error instanceof TRPCError || error instanceof GmailFailure ? error.message : 'Could not refresh this conversation.' })
    }
  }
  // Ordinary recipients see only messages demonstrably present in their own Gmail mailbox. No content is read from a colleague's token.
  let moreRecipientReferences = false
  if (!supervisor) {
    const references = (await pool.query(`SELECT l.*,m.owner_email,r.internet_id FROM email_links l JOIN email_mailboxes m ON m.id=l.mailbox_id JOIN email_link_messages r ON r.link_id=l.id
      WHERE l.entity_type=$1 AND l.entity_id=$2 AND l.removed_at IS NULL AND l.participant_visible AND m.owner_email<>$3 AND r.internet_id<>'' ORDER BY l.created_at DESC,l.id,r.provider_message_id LIMIT 21 OFFSET $4`, [entity.type, entity.id, actor.email, cursor])).rows
    moreRecipientReferences = references.length > 20
    for (const mailboxId of mailboxIds) {
      const mailbox = await loadEmailMailbox(mailboxId)
      if (!mailbox || !ownMailbox(actor, mailbox) || mailbox.status !== 'connected') continue
      const gmail = gmailFor(mailbox); const seen = new Set(rows.filter(value => value.link.item.mailboxId === mailboxId).map(value => `${value.link.item.kind}:${value.link.item.id}`))
      for (let offset = 0; offset < Math.min(references.length, 20); offset += 4) await Promise.all(references.slice(offset, Math.min(offset + 4, 20)).map(async ref => {
        const q = `rfc822msgid:${ref.internet_id.replace(/[<>"\\\r\n]/g, '')}`
        const matches = await gmail.request<{ messages?: { id: string; threadId: string }[] }>(`messages?${new URLSearchParams({ q, maxResults: '5', includeSpamTrash: 'false' })}`)
        for (const match of matches.messages ?? []) {
          const item: EmailItemRef = { mailboxId, kind: ref.item_kind, id: ref.item_kind === 'thread' ? match.threadId : match.id }
          if (seen.has(`${item.kind}:${item.id}`)) continue
          seen.add(`${item.kind}:${item.id}`)
          const conversation = await gmail.conversation(item.kind, item.id)
          const link = await linkDto(actor, ref, item)
          if (!link) continue
          rows.push({ link, summary: gmailSummary(conversation.messages), mailboxEmail: mailbox.provider_email, ownerEmail: mailbox.owner_email })
        }
      }))
      await recheckEmailAccess(actor, mailbox, { entity })
    }
  }
  await assertEmailEntity(actor, entity, true)
  return { items: rows, nextCursor: ownRows.length > 20 || moreRecipientReferences ? cursor + 20 : null }
}
