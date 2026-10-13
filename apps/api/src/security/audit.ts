import { pool } from '../db.js'

/** No request payloads, passwords, tokens, or encrypted credential envelopes. */
export async function beginSecurityAudit(uid: string, email: string, path: string) {
  try {
    const { rows } = await pool.query('INSERT INTO security_events (user_uid,email,procedure) VALUES ($1,$2,$3) RETURNING id', [uid, email, path])
    return rows[0].id as string
  } catch (cause) { console.error(JSON.stringify({ event: 'security.audit_start_failed', procedure: path })); throw cause }
}
export async function finishSecurityAudit(id: string, success: boolean) {
  try { await pool.query('UPDATE security_events SET outcome=$1, completed_at=now() WHERE id=$2', [success ? 'succeeded' : 'failed', id]) }
  catch { console.error(JSON.stringify({ event: 'security.audit_completion_failed', auditId: id })) }
}
