import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { PoolClient } from 'pg'
import { GOOGLE_SERVICES, DEFAULT_GOOGLE_INTEGRATIONS, type GoogleIntegrationSettings } from '@goms/domain'
import { protectedProcedure, protectedReadProcedure, router, type Context } from '../trpc.js'
import { isAmnexAccount, verifyLinkedIdentity, type LinkedIdentity } from '../auth/identity.js'
import { pool } from '../db.js'

async function account(ctx: Context): Promise<LinkedIdentity> {
  const user = await verifyLinkedIdentity(ctx.authHeader)
  if (!isAmnexAccount(user.email)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your @amnex.com Google account.' })
  return user
}
const mismatch = () => new TRPCError({ code: 'FORBIDDEN', message: 'Your signed-in account changed. Please retry.' })
const settingsShape = z.object({
  clientId: z.string().max(300).regex(/^$|^[\w.-]+\.apps\.googleusercontent\.com$/),
  disabledPages: z.record(z.enum(GOOGLE_SERVICES), z.array(z.string().regex(/^[a-z][a-z0-9-]{0,79}$/)).max(200)),
  disabledServices: z.array(z.enum(GOOGLE_SERVICES)).max(GOOGLE_SERVICES.length).optional(),
  mapsEmbedKey: z.string().max(200).regex(/^[\w-]*$/).optional(),
  docsId: z.string().max(200).regex(/^[\w-]*$/), sheetsId: z.string().max(200).regex(/^[\w-]*$/),
  cloudProject: z.string().max(100).regex(/^$|^[a-z0-9][a-z0-9-]*$/), notebookLocation: z.enum(['global', 'us', 'eu']),
}).strict()

interface Row { user_uid: string; google_sub: string | null; settings: GoogleIntegrationSettings }
type Queryable = Pick<PoolClient, 'query'>

/** The incident kill switch (see trpc.ts). Mutations are refused by their procedure tier; the one write a READ makes (the sub stamp below)
 *  must honour it too, or "read-only" would not be. */
const readOnlyMode = () => process.env.EMERGENCY_READ_ONLY === 'true'

/** One person = one row, found by the Google subject id the VERIFIED token proves (`user.googleSub`), else by the caller's own uid. An email is
 *  only ever stored, never used to look a row up: it can be changed or reassigned, and must never grant access to someone else's settings. A row
 *  stamped with a different sub than the token proves is refused (fail closed). `lock` takes row locks (FOR UPDATE) for the write path; the read
 *  path passes false and so issues a plain SELECT. */
async function findRow(db: Queryable, user: LinkedIdentity, lock: boolean): Promise<Row | undefined> {
  const { rows } = await db.query<Row>(
    `SELECT user_uid, google_sub, settings FROM google_integration_settings
      WHERE user_uid = $1 OR ($2::text IS NOT NULL AND google_sub = $2)${lock ? ' FOR UPDATE' : ''}`,
    [user.uid, user.googleSub ?? null],
  )
  const linked = user.googleSub ? rows.find((r) => r.google_sub === user.googleSub) : undefined
  if (linked) return linked
  const own = rows.find((r) => r.user_uid === user.uid)
  if (own && own.google_sub !== null && own.google_sub !== (user.googleSub ?? null)) throw mismatch()
  return own
}

/** Stamps the proven sub onto the caller's OWN row, only if no row carries that sub yet (the unique index would refuse a second one anyway). */
const stamp = (db: PoolClient, uid: string, sub: string) => db.query(
  `UPDATE google_integration_settings SET google_sub = $2
    WHERE user_uid = $1 AND google_sub IS NULL AND NOT EXISTS (SELECT 1 FROM google_integration_settings WHERE google_sub = $2)`,
  [uid, sub],
)

/** One transaction per request, serialised per person (their sub, else their uid), so two providers acting for the same person at once cannot
 *  create two rows. */
async function inTransaction<T>(user: LinkedIdentity, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.googleSub ? `sub:${user.googleSub}` : `uid:${user.uid}`])
    const out = await fn(db)
    await db.query('COMMIT')
    return out
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    db.release()
  }
}

/** The stamp on the read path: its own short transaction (serialised per person like every write), and a failure of ANY kind (database read-only or
 *  failing over, lock timeout, a lost race with the unique index) is swallowed after one fixed log line, because the settings were already read. The
 *  row simply stays unstamped and the next read or save tries again. Nothing about the person is logged. */
async function stampBestEffort(user: LinkedIdentity, uid: string, sub: string): Promise<void> {
  try {
    await inTransaction(user, (db) => stamp(db, uid, sub))
  } catch {
    console.warn(JSON.stringify({ event: 'googleIntegrations.stamp_skipped' }))
  }
}

/** Identity is verified through the shared identity seam, so it follows AUTH_PROVIDER exactly like every other procedure (Firebase, GOMS tokens, or
 *  both), even when the application's staged authentication flags are off. */
export const googleIntegrationsRouter = router({
  get: protectedReadProcedure.input(z.object({ accountUid: z.string().min(1).max(200) }).strict()).query(async ({ input, ctx }) => {
    const user = await account(ctx)
    if (input.accountUid !== user.uid) throw mismatch()
    // The read itself is a plain SELECT: no transaction, no row locks, no writes. A read that succeeds can therefore never be failed by the stamp.
    const row = await findRow(pool, user, false)
    if (!row) return { ...DEFAULT_GOOGLE_INTEGRATIONS }
    // Backfill: a pre-existing row that is the caller's own gets the proven sub, so the person can be found under the other provider later.
    // Best effort and never in read-only mode.
    if (user.googleSub && row.google_sub === null && !readOnlyMode()) await stampBestEffort(user, row.user_uid, user.googleSub)
    return row.settings
  }),
  save: protectedProcedure.input(z.object({ accountUid: z.string().min(1).max(200), settings: settingsShape }).strict()).mutation(async ({ input, ctx }) => {
    const user = await account(ctx)
    if (input.accountUid !== user.uid) throw mismatch()
    await inTransaction(user, async (db) => {
      const row = await findRow(db, user, true)
      if (row) {
        await db.query('UPDATE google_integration_settings SET email=$2, settings=$3, updated_at=now() WHERE user_uid=$1', [row.user_uid, user.email, input.settings])
        if (user.googleSub && row.google_sub === null) await stamp(db, row.user_uid, user.googleSub)
      } else {
        await db.query('INSERT INTO google_integration_settings (user_uid,email,settings,google_sub) VALUES ($1,$2,$3,$4)', [user.uid, user.email, input.settings, user.googleSub ?? null])
      }
    })
    return input.settings
  }),
})
