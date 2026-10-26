import { TRPCError } from '@trpc/server'
import type { PoolClient } from 'pg'

/** Used inside the existing people mutations' transactions for human-reviewed mail additions. */
export async function rejectKnownCommunicationEmail(db: PoolClient, email: string) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`communication-email:${email.trim().toLowerCase()}`])
  const found = await db.query(`SELECT 1 FROM (
    SELECT email FROM org_people UNION ALL SELECT email FROM delivery_team_members
    UNION ALL SELECT official_email AS email FROM sales_persons UNION ALL SELECT email FROM employees
    UNION ALL SELECT email FROM communication_contacts
  ) people WHERE lower(btrim(email))=lower(btrim($1)) LIMIT 1`, [email])
  if (found.rows.length) throw new TRPCError({ code: 'CONFLICT', message: 'This email already exists in a people master. Refresh and review the existing person.' })
}
