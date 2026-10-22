import type { EmailActor } from './access.js'
import { pool } from '../db.js'
import { inTransaction } from '../lib/rbacTreeStore.js'
export { inTransaction }
export interface MailboxRow {
  id: string; owner_uid: string; owner_email: string; provider_email: string; provider_subject: string | null;
  credentials: import('./config.js').SealedEmailCredentials | null; credential_revision: string; status: 'connected' | 'reconnect' | 'disconnected';
  scopes: string[]; last_sync_at: Date | null; last_error: string | null
}
export async function emailEvent(actor: Pick<EmailActor, 'email'>, action: string, values: { mailboxId?: string; kind?: string; itemId?: string; entity?: { type: string; id: string }; grantId?: string; details?: Record<string, string | number | boolean> }, db: { query: typeof pool.query } = pool) {
  await db.query(`INSERT INTO email_events(actor,action,mailbox_id,item_kind,item_id,entity_type,entity_id,grant_id,details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [actor.email, action, values.mailboxId ?? null, values.kind ?? null, values.itemId ?? null, values.entity?.type ?? null, values.entity?.id ?? null, values.grantId ?? null, JSON.stringify(values.details ?? {})])
}
export async function loadEmailMailbox(id: string): Promise<MailboxRow | null> { return (await pool.query('SELECT * FROM email_mailboxes WHERE id=$1', [id])).rows[0] ?? null }
