import { pool } from '../db.js'
import { assertEmailEntity, refreshEmailActor, type EmailActor } from './access.js'
import { gmailFor, GmailFailure } from './gmail.js'
import { indexEmailLink } from './service.js'
import { loadEmailMailbox } from './store.js'

/** Reconciles provider identifiers only. Bodies/attachments are always read through the live authorization path. */
export async function syncLinkedEmailReferences() {
  const db = await pool.connect()
  try {
    if (!(await db.query("SELECT pg_try_advisory_lock(hashtext('email-center-sync')) AS acquired")).rows[0]?.acquired) return
    const mailboxes = (await db.query("SELECT DISTINCT m.id FROM email_mailboxes m JOIN email_links l ON l.mailbox_id=m.id AND l.removed_at IS NULL WHERE m.status='connected' AND m.next_sync_at<=now() ORDER BY m.id LIMIT 10")).rows
    for (const candidate of mailboxes) {
      const mailbox = await loadEmailMailbox(candidate.id)
      if (!mailbox || mailbox.status !== 'connected') continue
      try {
        const actor = await refreshEmailActor({ uid: mailbox.owner_uid, email: mailbox.owner_email } as EmailActor)
        const gmail = gmailFor(mailbox)
        const links = (await pool.query('SELECT * FROM email_links WHERE mailbox_id=$1 AND removed_at IS NULL ORDER BY id', [mailbox.id])).rows
        for (const link of links) {
          try {
            const entity = { type: link.entity_type, id: link.entity_id }
            await assertEmailEntity(actor, entity, true)
            const conversation = await gmail.conversation(link.item_kind, link.item_id, true)
            await assertEmailEntity(actor, entity, true)
            const current = await loadEmailMailbox(mailbox.id)
            if (!current || current.status !== 'connected' || current.credential_revision !== mailbox.credential_revision) break
            await indexEmailLink(link, conversation.messages)
          } catch (error) {
            if (error instanceof GmailFailure && error.status === 404) { await pool.query("UPDATE email_links SET availability='deleted' WHERE id=$1", [link.id]); continue }
            if (error && typeof error === 'object' && 'code' in error && ['NOT_FOUND', 'FORBIDDEN'].includes(String(error.code))) continue
            throw error
          }
        }
        await pool.query('UPDATE email_mailboxes SET last_sync_at=now(),last_error=NULL,sync_failures=0,next_sync_at=now()+interval \'60 seconds\' WHERE id=$1 AND credential_revision=$2', [mailbox.id, mailbox.credential_revision])
      } catch (error) {
        const reconnect = error instanceof GmailFailure && [401, 403].includes(error.status)
        await pool.query(`UPDATE email_mailboxes SET last_error=$2,sync_failures=least(sync_failures+1,8),next_sync_at=now()+make_interval(secs=>least(3600,60*power(2,least(sync_failures,6)))::int),
          status=CASE WHEN $3 THEN 'reconnect' ELSE status END WHERE id=$1`, [mailbox.id, reconnect ? 'Google authorization must be renewed.' : 'Gmail synchronization failed; retry is scheduled.', reconnect])
      }
    }
  } finally {
    await db.query("SELECT pg_advisory_unlock(hashtext('email-center-sync'))").catch(() => undefined); db.release()
  }
}
export function startEmailSynchronizer() {
  let running = false
  const run = () => { if (!running) { running = true; void syncLinkedEmailReferences().catch(() => { console.warn(JSON.stringify({ event: 'email.sync_failed' })) }).finally(() => { running = false }) } }
  const timer = setInterval(run, 60_000); timer.unref(); run()
  return () => clearInterval(timer)
}
