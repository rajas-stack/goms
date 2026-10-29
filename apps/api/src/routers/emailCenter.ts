import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { COMMUNICATION_PARTIES, EMAIL_ACTIONS, type EmailCompose, type EmailEntityRef, type EmailGrant, type EmailItemRef, type EmailMessage } from '@goms/domain'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { emailConfiguration } from '../email/config.js'
import { beginMailConnection } from '../email/oauth.js'
import { assertEmailAction, assertEmailEntity, deniedEmailRecord, emailActionAllowed, emailActor, managesEmailOwner, refreshEmailActor, visibleEmailEntity } from '../email/access.js'
import { applicableEmailGrant, assertContextCorrespondence, authorizedEmailRelationships, authorizeEmailMailbox, contextEmails, emailMailboxDto, indexEmailLink, ownMailbox, recheckEmailAccess } from '../email/service.js'
import { buildEmailMime, gmailFor, gmailSummary, GmailFailure } from '../email/gmail.js'
import { emailEvent, inTransaction, loadEmailMailbox } from '../email/store.js'
import { isSystemAdminEmail } from '../auth/rbac/systemAdminOnly.js'
import { cachedSummary, rememberSummary } from '../email/summaryCache.js'
/** Parallel Gmail reads per list page: a full 20-row page of threads.get is 200 quota units, under the 250/s per-user limit. */
const LIST_CONCURRENCY = 20
/** Above ~4 MB the JSON endpoint is unreliable; Gmail's upload endpoint takes up to 35 MB. */
const isLarge = (mime: { raw: string }) => mime.raw.length > 4 * 1024 * 1024
const threadOf = (mime: { threadId?: string }) => (mime.threadId ? { threadId: mime.threadId } : {})

const uuid = z.string().uuid()
const providerId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/)
const email = z.string().trim().toLowerCase().email().max(254)
const entity = z.object({ type: z.string().regex(/^[a-z][a-z0-9-]{0,59}$/), id: uuid }).strict()
const item = z.object({ mailboxId: uuid, kind: z.enum(['message', 'thread']), id: providerId }).strict()
const context = z.object({ entity: entity.optional(), supervisor: z.boolean().default(false) })
const readInput = context.extend({ item, unlinked: z.boolean().default(false) }).strict()
const compose = z.object({
  mailboxId: uuid, from: email, to: z.array(email).max(100), cc: z.array(email).max(100), bcc: z.array(email).max(100),
  subject: z.string().max(500).refine(value => !/[\r\n]/.test(value), 'Subject must be one line.'), text: z.string().max(500_000),
  attachments: z.array(z.object({ name: z.string().min(1).max(260), mimeType: z.string().max(100), data: z.string().max(35_000_000) }).strict()).max(20),
  draftId: providerId.optional(), requestId: uuid,
  draftMessageId: providerId.optional(), keepDraftAttachments: z.boolean().default(true),
  reply: z.object({ item, messageId: providerId, entity: entity.optional(), mode: z.enum(['reply', 'replyAll', 'forward']) }).strict().optional(),
  forwardAttachments: z.boolean().optional(),
}).strict()
const ownRequired = () => new TRPCError({ code: 'FORBIDDEN', message: 'Use your own authenticated sending mailbox.' })
const grantDto = (row: any): EmailGrant => ({ id: row.id, mailboxId: row.mailbox_id, mailboxEmail: row.provider_email, ownerEmail: row.owner_email, grantee: row.grantee, kind: row.kind, entity: row.entity_type ? { type: row.entity_type, id: row.entity_id } : null, includeUnlinked: row.include_unlinked, allowDownload: row.allow_download, expiresAt: new Date(row.expires_at).toISOString(), status: row.status, approvalReference: row.approval_reference, approvedBy: row.approved_by, createdAt: new Date(row.created_at).toISOString() })

async function readEmail(actor: Awaited<ReturnType<typeof emailActor>>, input: z.infer<typeof readInput>, metadata = false) {
  const mailbox = await authorizeEmailMailbox(actor, input.item.mailboxId, { entity: input.entity, supervisor: input.supervisor, allowUnlinked: input.unlinked || !input.entity })
  const gmail = gmailFor(mailbox)
  const conversation = await gmail.conversation(input.item.kind, input.item.id, metadata)
  if (input.unlinked && !input.supervisor) throw deniedEmailRecord()
  if (input.entity && !input.unlinked) await assertContextCorrespondence(actor, mailbox, input.item, conversation.messages, input.entity)
  else if (!ownMailbox(actor, mailbox)) await applicableEmailGrant(actor, mailbox, input.entity).then(grant => { if (!grant.include_unlinked) throw deniedEmailRecord() })
  const current = await recheckEmailAccess(actor, mailbox, { entity: input.entity, supervisor: input.supervisor, allowUnlinked: input.unlinked || !input.entity })
  for (const message of conversation.messages) if (!message.labels.includes('SENT')) message.bcc = message.bcc.filter(person => person.email === mailbox.provider_email)
  const links = await authorizedEmailRelationships(current, mailbox, input.item, conversation.messages)
  return { mailbox, gmail, conversation, links }
}
async function prepareCompose(actor: Awaited<ReturnType<typeof emailActor>>, input: z.infer<typeof compose>) {
  const mailbox = await authorizeEmailMailbox(actor, input.mailboxId, { action: 'send' })
  if (!ownMailbox(actor, mailbox)) throw ownRequired()
  const gmail = gmailFor(mailbox); const identities = await gmail.identities()
  if (!identities.some(identity => identity.email === input.from)) throw ownRequired()
  let reply: { message: EmailMessage; sameMailbox: boolean } | undefined
  const forwarded: EmailCompose['attachments'] = []
  if (input.draftId) {
    const draft = await gmail.request<{ message: import('../email/gmail.js').GmailMessage }>(`drafts/${encodeURIComponent(input.draftId)}?format=full`)
    const { gmailMessage } = await import('../email/gmail.js'); const existing = gmailMessage(draft.message)
    if (!input.draftMessageId || input.draftMessageId !== existing.id) throw new TRPCError({ code: 'CONFLICT', message: 'This draft changed in Gmail. Reopen it before saving or sending.' })
    if (input.keepDraftAttachments) for (const attachment of existing.attachments) { const file = await gmail.attachment(existing.id, attachment, draft.message); forwarded.push({ name: attachment.name, mimeType: attachment.mimeType, data: Buffer.from(file.data, 'base64url').toString('base64') }) }
  }
  if (input.reply) {
    const source = await readEmail(actor, { item: input.reply.item, entity: input.reply.entity, supervisor: false, unlinked: false })
    const message = source.conversation.messages.find(message => message.id === input.reply!.messageId)
    if (!message) throw deniedEmailRecord()
    reply = { message, sameMailbox: mailbox.id === source.mailbox.id }
    if (input.reply.mode === 'forward' && input.forwardAttachments) for (const attachment of message.attachments) {
      assertEmailAction(actor, 'download')
      const file = await source.gmail.attachment(message.id, attachment)
      forwarded.push({ name: attachment.name, mimeType: attachment.mimeType, data: Buffer.from(file.data, 'base64url').toString('base64') })
    }
  }
  const mime = buildEmailMime(input, reply, forwarded)
  await recheckEmailAccess(actor, mailbox, { action: 'send' })
  return { mailbox, gmail, mime }
}

export const emailCenterRouter = router({
  status: protectedReadProcedure.query(async ({ ctx }) => {
    const actor = await emailActor(ctx); const cfg = emailConfiguration()
    return { ready: cfg.ready, callback: cfg.ready ? cfg.redirectUri : null, email: actor.email, administrator: isSystemAdminEmail(actor.email), capabilities: EMAIL_ACTIONS.filter(action => emailActionAllowed(actor, action)) }
  }),
  connect: protectedProcedure.input(z.object({ returnTo: z.string().max(512) }).strict()).mutation(async ({ input, ctx }) => beginMailConnection(await emailActor(ctx), input.returnTo, ctx.setCookie)),
  mailboxes: protectedReadProcedure.input(context.extend({ mode: z.enum(['mine', 'supervisor']).default('mine') }).strict()).query(async ({ input, ctx }) => {
    const actor = await emailActor(ctx)
    if (input.entity) await assertEmailEntity(actor, input.entity)
    if (input.mode === 'mine') return (await pool.query('SELECT * FROM email_mailboxes WHERE owner_email=$1 ORDER BY provider_email', [actor.email])).rows.map(row => emailMailboxDto(actor, row))
    assertEmailAction(actor, 'supervisor')
    const rows = (await pool.query(`SELECT DISTINCT m.* FROM email_mailboxes m JOIN email_access_grants g ON g.mailbox_id=m.id WHERE g.grantee=$1 AND g.status='approved' AND g.expires_at>now()`, [actor.email])).rows
    const result = []
    for (const row of rows) {
      try { const grant = await applicableEmailGrant(actor, row, input.entity); const dto = emailMailboxDto(actor, row, true); if (!grant.allow_download) dto.capabilities = dto.capabilities.filter(action => action !== 'download'); result.push(dto) }
      catch (error) { if (!(error instanceof TRPCError) || !['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) throw error }
    }
    return result
  }),
  disconnect: protectedProcedure.input(z.object({ mailboxId: uuid, confirmed: z.literal(true) }).strict()).mutation(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); const mailbox = await loadEmailMailbox(input.mailboxId)
    if (!mailbox || !ownMailbox(actor, mailbox)) throw deniedEmailRecord()
    await inTransaction(async db => {
      await db.query("UPDATE email_mailboxes SET status='disconnected',credentials=NULL,credential_revision=gen_random_uuid(),last_error=NULL,updated_at=now() WHERE id=$1", [mailbox.id])
      const grants = (await db.query("UPDATE email_access_grants SET status='revoked',updated_at=now() WHERE mailbox_id=$1 AND status<>'revoked' RETURNING id", [mailbox.id])).rows
      for (const grant of grants) await emailEvent(actor, 'supervisory_permission_revoked', { mailboxId: mailbox.id, grantId: grant.id }, db)
      await emailEvent(actor, 'mailbox_disconnected', { mailboxId: mailbox.id }, db)
    })
  }),
  labels: protectedReadProcedure.input(z.object({ mailboxId: uuid }).strict()).query(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); const mailbox = await authorizeEmailMailbox(actor, input.mailboxId)
    if (!ownMailbox(actor, mailbox)) throw deniedEmailRecord()
    const result = await gmailFor(mailbox).request<{ labels?: { id: string; name: string; type: string }[] }>('labels')
    await recheckEmailAccess(actor, mailbox); return result.labels ?? []
  }),
  createLabel: protectedProcedure.input(z.object({ mailboxId: uuid, name: z.string().trim().min(1).max(100) }).strict()).mutation(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); assertEmailAction(actor, 'manageMailbox'); const mailbox = await authorizeEmailMailbox(actor, input.mailboxId)
    if (!ownMailbox(actor, mailbox)) throw deniedEmailRecord()
    return gmailFor(mailbox).request<{ id: string; name: string }>('labels', 'POST', { name: input.name, labelListVisibility: 'labelShow', messageListVisibility: 'show' })
  }),
  list: protectedReadProcedure.input(context.extend({ mailboxId: uuid, folder: z.string().max(200).default('INBOX'), q: z.string().max(1500).default(''), pageToken: z.string().max(2000).optional(), unlinkedOnly: z.boolean().default(false) }).strict()).query(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); const mailbox = await authorizeEmailMailbox(actor, input.mailboxId, { entity: input.entity, supervisor: input.supervisor, allowUnlinked: true })
    const gmail = gmailFor(mailbox); const params = new URLSearchParams({ maxResults: '20', ...(input.q ? { q: input.q } : {}), ...(input.pageToken ? { pageToken: input.pageToken } : {}) })
    if (input.folder !== 'ALL' && input.folder !== 'DRAFT') params.set('labelIds', input.folder)
    const items = []
    let nextPageToken: string | undefined
    if (input.folder === 'DRAFT') {
      const result = await gmail.request<{ drafts?: { id: string }[]; nextPageToken?: string }>(`drafts?${params}`); nextPageToken = result.nextPageToken
      const { gmailMessage } = await import('../email/gmail.js')
      const drafts = result.drafts ?? []
      for (let i = 0; i < drafts.length; i += LIST_CONCURRENCY) items.push(...await Promise.all(drafts.slice(i, i + LIST_CONCURRENCY).map(async draft => {
        const data = await gmail.request<{ id: string; message: import('../email/gmail.js').GmailMessage }>(`drafts/${encodeURIComponent(draft.id)}?format=metadata`)
        return gmailSummary([gmailMessage(data.message)], data.id)
      })))
    } else {
      const result = await gmail.request<{ threads?: { id: string; historyId?: string }[]; nextPageToken?: string }>(`threads?${params}`); nextPageToken = result.nextPageToken
      // Unchanged threads (same historyId) come from the summary cache; only new or changed ones go back to Gmail, all in one round.
      const threads = result.threads ?? []
      for (let i = 0; i < threads.length; i += LIST_CONCURRENCY) items.push(...await Promise.all(threads.slice(i, i + LIST_CONCURRENCY).map(async item => {
        const hit = cachedSummary(mailbox, item.id, item.historyId)
        if (hit) return hit
        const summary = await gmail.threadSummary(item.id)
        rememberSummary(mailbox, item.id, item.historyId, summary)
        return summary
      })))
    }
    const filtered = []
    for (const summary of items) {
      if (!input.unlinkedOnly) { filtered.push(summary); continue }
      const messages = (await gmail.conversation('thread', summary.threadId, true)).messages
      const links = await authorizedEmailRelationships(actor, mailbox, { mailboxId: mailbox.id, kind: 'thread', id: summary.threadId }, messages)
      if (!links.length) filtered.push(summary)
    }
    // One recheck after every Gmail read (access may have been revoked meanwhile) — the earlier duplicate added a DB round for nothing.
    await recheckEmailAccess(actor, mailbox, { entity: input.entity, supervisor: input.supervisor, allowUnlinked: true })
    return { items: filtered.sort((a, b) => b.date.localeCompare(a.date)), nextPageToken: nextPageToken ?? null }
  }),
  read: protectedReadProcedure.input(readInput).query(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); const result = await readEmail(actor, input)
    const mailbox = emailMailboxDto(actor, result.mailbox, input.supervisor)
    if (!mailbox.own) { const grant = await applicableEmailGrant(actor, result.mailbox, input.entity); if (!grant.allow_download) mailbox.capabilities = mailbox.capabilities.filter(action => action !== 'download') }
    return { conversation: result.conversation, links: result.links, mailbox }
  }),
  draft: protectedReadProcedure.input(z.object({ mailboxId: uuid, draftId: providerId }).strict()).query(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); const mailbox = await authorizeEmailMailbox(actor, input.mailboxId, { action: 'send' })
    if (!ownMailbox(actor, mailbox)) throw ownRequired()
    const draft = await gmailFor(mailbox).request<{ message: import('../email/gmail.js').GmailMessage }>(`drafts/${encodeURIComponent(input.draftId)}?format=full`)
    const { gmailMessage } = await import('../email/gmail.js')
    await recheckEmailAccess(actor, mailbox, { action: 'send' }); return gmailMessage(draft.message)
  }),
  identities: protectedReadProcedure.input(z.object({ mailboxId: uuid }).strict()).query(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); const mailbox = await authorizeEmailMailbox(actor, input.mailboxId, { action: 'send' })
    if (!ownMailbox(actor, mailbox)) throw ownRequired()
    const identities = await gmailFor(mailbox).identities(); await recheckEmailAccess(actor, mailbox, { action: 'send' }); return identities
  }),
  attachment: protectedReadProcedure.input(readInput.extend({ messageId: providerId, attachmentId: z.string().max(1000), partId: z.string().max(100) }).strict()).query(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); assertEmailAction(actor, 'download')
    const result = await readEmail(actor, input)
    if (!ownMailbox(actor, result.mailbox)) await applicableEmailGrant(actor, result.mailbox, input.entity, true)
    const descriptor = result.conversation.messages.find(message => message.id === input.messageId)?.attachments.find(attachment => attachment.id === input.attachmentId && attachment.partId === input.partId)
    if (!descriptor) throw deniedEmailRecord()
    const file = await result.gmail.attachment(input.messageId, descriptor)
    await recheckEmailAccess(actor, result.mailbox, { action: 'download', entity: input.entity, supervisor: input.supervisor, allowUnlinked: input.unlinked || !input.entity })
    return { name: descriptor.name, mimeType: descriptor.mimeType, data: file.data, size: file.size }
  }),
  saveDraft: protectedProcedure.input(compose).mutation(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); const { gmail, mime, mailbox } = await prepareCompose(actor, input)
    const result = await gmail.request<{ id: string; message: { id: string } }>(input.draftId ? `drafts/${encodeURIComponent(input.draftId)}` : 'drafts', input.draftId ? 'PUT' : 'POST', { message: mime })
    await emailEvent(actor, 'draft_saved', { mailboxId: mailbox.id, kind: 'message', itemId: result.message.id }); return { draftId: result.id, messageId: result.message.id }
  }),
  send: protectedProcedure.input(compose.extend({ confirmed: z.literal(true) }).strict()).mutation(async ({ input, ctx }) => {
    const actor = await emailActor(ctx)
    if (!input.to.length && !input.cc.length && !input.bcc.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add at least one recipient.' })
    const { gmail, mime, mailbox } = await prepareCompose(actor, input)
    const reserved = await pool.query("INSERT INTO email_send_requests(mailbox_id,request_id,status) VALUES ($1,$2,'pending') ON CONFLICT DO NOTHING RETURNING request_id", [mailbox.id, input.requestId])
    if (!reserved.rows.length) {
      const previous = (await pool.query('SELECT * FROM email_send_requests WHERE mailbox_id=$1 AND request_id=$2', [mailbox.id, input.requestId])).rows[0]
      if (previous?.status === 'sent') return { messageId: previous.provider_message_id as string }
      throw new TRPCError({ code: 'CONFLICT', message: 'This send may already have reached Gmail. Check Sent before starting another send.' })
    }
    await emailEvent(actor, 'send_requested', { mailboxId: mailbox.id })
    try {
      let result: { id: string }
      if (input.draftId) {
        if (isLarge(mime)) await gmail.upload(`drafts/${encodeURIComponent(input.draftId)}`, 'PUT', { message: threadOf(mime) }, mime.raw)
        else await gmail.request(`drafts/${encodeURIComponent(input.draftId)}`, 'PUT', { message: mime })
        result = await gmail.request<{ id: string }>('drafts/send', 'POST', { id: input.draftId })
      } else result = isLarge(mime) ? await gmail.upload<{ id: string }>('messages/send', 'POST', threadOf(mime), mime.raw) : await gmail.request<{ id: string }>('messages/send', 'POST', mime)
      await pool.query("UPDATE email_send_requests SET status='sent',provider_message_id=$3 WHERE mailbox_id=$1 AND request_id=$2", [mailbox.id, input.requestId, result.id])
      await emailEvent(actor, 'message_sent', { mailboxId: mailbox.id, kind: 'message', itemId: result.id })
      return { messageId: result.id }
    } catch (error) { await pool.query("UPDATE email_send_requests SET status='unknown' WHERE mailbox_id=$1 AND request_id=$2 AND status='pending'", [mailbox.id, input.requestId]); throw error }
  }),
  discardDraft: protectedProcedure.input(z.object({ mailboxId: uuid, draftId: providerId, confirmed: z.literal(true) }).strict()).mutation(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); const mailbox = await authorizeEmailMailbox(actor, input.mailboxId, { action: 'send' }); if (!ownMailbox(actor, mailbox)) throw ownRequired()
    await gmailFor(mailbox).request(`drafts/${encodeURIComponent(input.draftId)}`, 'DELETE'); await emailEvent(actor, 'draft_discarded', { mailboxId: mailbox.id })
  }),
  modify: protectedProcedure.input(z.object({ item, operation: z.enum(['read', 'unread', 'star', 'unstar', 'archive', 'addLabel', 'removeLabel']), labelId: providerId.optional() }).strict()).mutation(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); assertEmailAction(actor, 'manageMailbox'); const mailbox = await authorizeEmailMailbox(actor, input.item.mailboxId); if (!ownMailbox(actor, mailbox)) throw deniedEmailRecord()
    const ids = { read: { removeLabelIds: ['UNREAD'] }, unread: { addLabelIds: ['UNREAD'] }, star: { addLabelIds: ['STARRED'] }, unstar: { removeLabelIds: ['STARRED'] }, archive: { removeLabelIds: ['INBOX'] }, addLabel: { addLabelIds: [input.labelId] }, removeLabel: { removeLabelIds: [input.labelId] } }[input.operation]
    if (['addLabel', 'removeLabel'].includes(input.operation) && !input.labelId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose an existing Gmail label.' })
    await gmailFor(mailbox).request(`${input.item.kind === 'thread' ? 'threads' : 'messages'}/${encodeURIComponent(input.item.id)}/modify`, 'POST', ids)
    await emailEvent(actor, 'mailbox_labels_changed', { mailboxId: mailbox.id, kind: input.item.kind, itemId: input.item.id })
  }),
  context: protectedReadProcedure.input(z.object({ entity, mode: z.enum(['mine', 'team', 'supervisor']).default('mine'), mailboxId: uuid.optional(), cursor: z.number().int().min(0).max(100000).default(0) }).strict()).query(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); await assertEmailEntity(actor, input.entity)
    if (input.mode === 'team') assertEmailAction(actor, 'team')
    if (input.mode === 'supervisor') assertEmailAction(actor, 'supervisor')
    let ids: string[]
    if (input.mode === 'supervisor') {
      const grants = (await pool.query("SELECT DISTINCT mailbox_id FROM email_access_grants WHERE grantee=$1 AND status='approved' AND expires_at>now()", [actor.email])).rows
      ids = []
      for (const row of grants) {
        if (input.mailboxId && input.mailboxId !== row.mailbox_id) continue
        try { const mailbox = await loadEmailMailbox(row.mailbox_id); if (mailbox) { await applicableEmailGrant(actor, mailbox, input.entity); ids.push(mailbox.id) } } catch (error) { if (!(error instanceof TRPCError) || !['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) throw error }
      }
    } else ids = (await pool.query('SELECT id FROM email_mailboxes WHERE owner_email=$1', [actor.email])).rows.map(row => row.id).filter(id => !input.mailboxId || id === input.mailboxId)
    return contextEmails(actor, input.entity, ids, input.mode === 'supervisor', input.cursor)
  }),
  link: protectedProcedure.input(z.object({ item, entity, participantVisible: z.boolean(), confirmed: z.literal(true) }).strict()).mutation(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); assertEmailAction(actor, 'link'); if (input.participantVisible) assertEmailAction(actor, 'share')
    await assertEmailEntity(actor, input.entity)
    const mailbox = await authorizeEmailMailbox(actor, input.item.mailboxId, { action: 'link', entity: input.entity }); if (!ownMailbox(actor, mailbox)) throw deniedEmailRecord()
    const conversation = await gmailFor(mailbox).conversation(input.item.kind, input.item.id, true)
    await recheckEmailAccess(actor, mailbox, { action: 'link', entity: input.entity })
    const row = await inTransaction(async db => {
      const written = await db.query(`INSERT INTO email_links(mailbox_id,item_kind,item_id,entity_type,entity_id,participant_visible,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(mailbox_id,item_kind,item_id,entity_type,entity_id) DO UPDATE SET removed_at=NULL,participant_visible=EXCLUDED.participant_visible
        WHERE email_links.removed_at IS NOT NULL OR email_links.participant_visible IS DISTINCT FROM EXCLUDED.participant_visible RETURNING *`, [mailbox.id, input.item.kind, input.item.id, input.entity.type, input.entity.id, input.participantVisible, actor.email])
      const value = written.rows[0] ?? (await db.query('SELECT * FROM email_links WHERE mailbox_id=$1 AND item_kind=$2 AND item_id=$3 AND entity_type=$4 AND entity_id=$5', [mailbox.id, input.item.kind, input.item.id, input.entity.type, input.entity.id])).rows[0]
      if (written.rows.length) await emailEvent(actor, 'record_linked', { mailboxId: mailbox.id, kind: input.item.kind, itemId: input.item.id, entity: input.entity, details: { participantVisible: input.participantVisible } }, db)
      return value
    })
    await indexEmailLink(row, conversation.messages); return { id: row.id as string }
  }),
  unlink: protectedProcedure.input(z.object({ id: uuid, confirmed: z.literal(true) }).strict()).mutation(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); assertEmailAction(actor, 'unlink')
    const row = (await pool.query('SELECT l.*,m.owner_email FROM email_links l JOIN email_mailboxes m ON m.id=l.mailbox_id WHERE l.id=$1', [input.id])).rows[0]
    if (!row || row.owner_email !== actor.email) throw deniedEmailRecord()
    await assertEmailEntity(actor, { type: row.entity_type, id: row.entity_id })
    await inTransaction(async db => { const changed = await db.query('UPDATE email_links SET removed_at=now() WHERE id=$1 AND removed_at IS NULL RETURNING id', [row.id]); if (changed.rows.length) await emailEvent(actor, 'record_unlinked', { mailboxId: row.mailbox_id, kind: row.item_kind, itemId: row.item_id, entity: { type: row.entity_type, id: row.entity_id } }, db) })
  }),
  setCategory: protectedProcedure.input(z.object({ id: uuid, category: z.enum(COMMUNICATION_PARTIES).nullable() }).strict()).mutation(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); assertEmailAction(actor, 'link')
    const row = (await pool.query('SELECT l.*,m.owner_email FROM email_links l JOIN email_mailboxes m ON m.id=l.mailbox_id WHERE l.id=$1 AND l.removed_at IS NULL', [input.id])).rows[0]
    if (!row || row.owner_email !== actor.email) throw deniedEmailRecord()
    await assertEmailEntity(actor, { type: row.entity_type, id: row.entity_id })
    await pool.query('UPDATE email_links SET category=$2 WHERE id=$1', [row.id, input.category])
  }),
  entities: protectedReadProcedure.input(z.object({ type: z.enum(['opportunity', 'meeting', 'department', 'contact']), q: z.string().max(200), cursor: z.number().int().min(0).max(100000).default(0) }).strict()).query(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); const sources = { opportunity: ['opportunities', 'opportunity_name'], meeting: ['timeline_events', 'title'], department: ['hierarchy_nodes', 'name'], contact: ['employees', 'name'] } as const
    const [table, column] = sources[input.type]
    const rows = (await pool.query(`SELECT id FROM ${table} WHERE ${column} ILIKE $1 ${input.type === 'department' ? "AND domain='org'" : ''} ORDER BY id LIMIT 41 OFFSET $2`, [`%${input.q}%`, input.cursor])).rows
    const items = []
    for (const row of rows.slice(0, 40)) { const value = await visibleEmailEntity(actor, { type: input.type, id: row.id }); if (value) items.push(value) }
    return { items, nextCursor: rows.length > 40 ? input.cursor + 40 : null }
  }),
  suggestions: protectedReadProcedure.input(readInput).query(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); const source = await readEmail(actor, input, true)
    const addresses = [...new Set(source.conversation.messages.flatMap(message => [...message.from, ...message.to, ...message.cc].map(person => person.email)))]; const subject = source.conversation.subject
    const refs: EmailEntityRef[] = []
    const contacts = (await pool.query('SELECT id FROM employees WHERE lower(btrim(email))=ANY($1::text[]) LIMIT 40', [addresses])).rows
    refs.push(...contacts.map(row => ({ type: 'contact', id: row.id })))
    const meetings = (await pool.query('SELECT t.id FROM timeline_events t LEFT JOIN employees e ON e.id=t.employee_id WHERE lower(btrim(e.email))=ANY($1::text[]) OR (length(t.title)>=5 AND position(lower(t.title) in lower($2))>0) ORDER BY t.date DESC LIMIT 40', [addresses, subject])).rows
    refs.push(...meetings.map(row => ({ type: 'meeting', id: row.id })))
    const opportunities = (await pool.query("SELECT id FROM opportunities WHERE (length(opportunity_name)>=5 AND position(lower(opportunity_name) in lower($1))>0) OR (length(gem_tender_id)>=5 AND position(lower(gem_tender_id) in lower($1))>0) LIMIT 40", [subject])).rows
    refs.push(...opportunities.map(row => ({ type: 'opportunity', id: row.id })))
    const items = []
    for (const ref of refs) { const value = await visibleEmailEntity(actor, ref); if (value) items.push(value) }
    await recheckEmailAccess(actor, source.mailbox, { entity: input.entity, supervisor: input.supervisor }); return items
  }),
  stakeholders: protectedReadProcedure.input(z.object({ entity }).strict()).query(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); await assertEmailEntity(actor, input.entity)
    if (input.entity.type !== 'opportunity') return []
    const row = (await pool.query('SELECT geo_sales_person_id,bu_sales_person_id,pre_sales_person_id,legal_person_id,bid_team_member_id FROM opportunities WHERE id=$1', [input.entity.id])).rows[0]
    if (!row) return []
    return (await pool.query(`SELECT name,lower(btrim(official_email)) AS email FROM sales_persons WHERE id=ANY($1::uuid[]) AND btrim(official_email)<>''
      UNION SELECT name,lower(btrim(email)) FROM delivery_team_members WHERE id=ANY($2::uuid[]) AND btrim(email)<>''`, [[row.geo_sales_person_id, row.bu_sales_person_id].filter(Boolean), [row.pre_sales_person_id, row.legal_person_id, row.bid_team_member_id].filter(Boolean)])).rows as { name: string; email: string }[]
  }),
  suggestStakeholder: protectedProcedure.input(z.object({ entity, email, reason: z.string().trim().min(1).max(500), confirmed: z.literal(true) }).strict()).mutation(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); assertEmailAction(actor, 'link'); await assertEmailEntity(actor, input.entity)
    await pool.query('INSERT INTO email_stakeholder_suggestions(entity_type,entity_id,email,suggested_by,reason) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [input.entity.type, input.entity.id, input.email, actor.email, input.reason])
    await emailEvent(actor, 'stakeholder_suggested', { entity: input.entity })
  }),
  grants: protectedReadProcedure.query(async ({ ctx }) => {
    const actor = await emailActor(ctx); assertEmailAction(actor, 'manageAccess')
    const admin = isSystemAdminEmail(actor.email)
    const rows = (await pool.query('SELECT g.*,m.owner_email,m.provider_email FROM email_access_grants g JOIN email_mailboxes m ON m.id=g.mailbox_id WHERE m.owner_email=$1 OR g.grantee=$1 OR $2 ORDER BY g.created_at DESC LIMIT 200', [actor.email, admin])).rows
    const grants = []
    for (const row of rows) {
      const grant = grantDto(row)
      // Owners can still revoke consent after losing record access, without rediscovering the restricted association.
      if (!admin && grant.entity && !await visibleEmailEntity(actor, grant.entity)) { grant.entity = null; grant.scopeUnavailable = true }
      grants.push(grant)
    }
    return grants
  }),
  requestGrant: protectedProcedure.input(z.object({ mailboxId: uuid, grantee: email.refine(value => value.endsWith('@amnex.com')), kind: z.enum(['hod', 'superadmin']), entity: entity.nullable(), includeUnlinked: z.boolean(), allowDownload: z.boolean(), expiresAt: z.iso.datetime(), ownerConsent: z.literal(true) }).strict()).mutation(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); assertEmailAction(actor, 'manageAccess'); const mailbox = await loadEmailMailbox(input.mailboxId)
    if (!mailbox || !ownMailbox(actor, mailbox) || mailbox.status !== 'connected' || input.grantee === actor.email) throw deniedEmailRecord()
    if (input.entity) await assertEmailEntity(actor, input.entity)
    if (Date.parse(input.expiresAt) <= Date.now() || Date.parse(input.expiresAt) > Date.now() + 366 * 86400000) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose an expiry within the next year.' })
    if (input.kind === 'hod' && !await managesEmailOwner(input.grantee, actor.email) || input.kind === 'superadmin' && !isSystemAdminEmail(input.grantee)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose an active supervisor in your org reporting line, or an allow-listed System Admin.' })
    return inTransaction(async db => {
      const row = (await db.query(`INSERT INTO email_access_grants(mailbox_id,grantee,kind,entity_type,entity_id,include_unlinked,allow_download,expires_at,requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [mailbox.id, input.grantee, input.kind, input.entity?.type ?? null, input.entity?.id ?? null, input.includeUnlinked, input.allowDownload, input.expiresAt, actor.email])).rows[0]
      await emailEvent(actor, 'supervisory_permission_requested', { mailboxId: mailbox.id, grantId: row.id, entity: input.entity ?? undefined }, db); return { id: row.id as string }
    })
  }),
  approveGrant: protectedProcedure.input(z.object({ id: uuid, approvalReference: z.string().trim().min(8).max(500), organizationAuthorized: z.literal(true) }).strict()).mutation(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); assertEmailAction(actor, 'manageAccess'); if (!isSystemAdminEmail(actor.email)) throw deniedEmailRecord()
    const row = (await pool.query('SELECT g.*,m.owner_email,m.status AS mailbox_status FROM email_access_grants g JOIN email_mailboxes m ON m.id=g.mailbox_id WHERE g.id=$1', [input.id])).rows[0]
    if (!row || row.status !== 'pending' || row.mailbox_status !== 'connected' || new Date(row.expires_at).getTime() <= Date.now()) throw deniedEmailRecord()
    if (row.kind === 'hod' && !await managesEmailOwner(row.grantee, row.owner_email) || row.kind === 'superadmin' && !isSystemAdminEmail(row.grantee)) throw deniedEmailRecord()
    await inTransaction(async db => { await db.query("UPDATE email_access_grants SET status='approved',approved_by=$2,approval_reference=$3,updated_at=now() WHERE id=$1 AND status='pending'", [row.id, actor.email, input.approvalReference]); await emailEvent(actor, 'supervisory_permission_approved', { mailboxId: row.mailbox_id, grantId: row.id, entity: row.entity_type ? { type: row.entity_type, id: row.entity_id } : undefined }, db) })
  }),
  revokeGrant: protectedProcedure.input(z.object({ id: uuid, confirmed: z.literal(true) }).strict()).mutation(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); assertEmailAction(actor, 'manageAccess')
    const row = (await pool.query('SELECT g.*,m.owner_email FROM email_access_grants g JOIN email_mailboxes m ON m.id=g.mailbox_id WHERE g.id=$1', [input.id])).rows[0]
    if (!row || row.owner_email !== actor.email && !isSystemAdminEmail(actor.email)) throw deniedEmailRecord()
    await inTransaction(async db => { await db.query("UPDATE email_access_grants SET status='revoked',updated_at=now() WHERE id=$1", [row.id]); await emailEvent(actor, 'supervisory_permission_revoked', { mailboxId: row.mailbox_id, grantId: row.id }, db) })
  }),
  history: protectedReadProcedure.input(z.object({ item, entity: entity.optional(), cursor: z.number().int().min(0).default(0) }).strict()).query(async ({ input, ctx }) => {
    const actor = await emailActor(ctx); await authorizeEmailMailbox(actor, input.item.mailboxId, { entity: input.entity })
    const rows = (await pool.query('SELECT action,entity_type,entity_id,created_at FROM email_events WHERE mailbox_id=$1 AND item_kind=$2 AND item_id=$3 ORDER BY id DESC LIMIT 41 OFFSET $4', [input.item.mailboxId, input.item.kind, input.item.id, input.cursor])).rows
    const items = []
    for (const row of rows.slice(0, 40)) { const ref = row.entity_type ? await visibleEmailEntity(actor, { type: row.entity_type, id: row.entity_id }) : null; if (row.entity_type && !ref) continue; items.push({ action: row.action, entity: ref, at: new Date(row.created_at).toISOString() }) }
    return { items, nextCursor: rows.length > 40 ? input.cursor + 40 : null }
  }),
})
