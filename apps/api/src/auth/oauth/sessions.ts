// apps/api/src/auth/oauth/sessions.ts
import { pool } from '../../db.js'
import { isAmnexAccount } from '../identity.js'
import { refreshTtlDays } from './config.js'
import { randomToken, sha256Hex } from './crypto.js'

export class SessionError extends Error {
  readonly kind: 'invalid' | 'reuse' | 'not_amnex'
  constructor(kind: 'invalid' | 'reuse' | 'not_amnex') { super(kind); this.name = 'SessionError'; this.kind = kind }
}

const plausible = (t: unknown): t is string => typeof t === 'string' && t.length >= 16 && t.length <= 128

const REVOKE_FAMILY = `UPDATE auth_sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`

/** Generation 1 of a family. Only the SHA-256 of the refresh token is stored. */
export async function startSession(i: { uid: string; email: string; familyId: string; userAgent?: string }): Promise<{ refreshToken: string }> {
  const refreshToken = randomToken()
  await pool.query(
    `INSERT INTO auth_sessions (uid, email, refresh_hash, family_id, expires_at, user_agent)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval, $6)`,
    [i.uid, i.email, sha256Hex(refreshToken), i.familyId, String(refreshTtlDays()), i.userAgent?.slice(0, 200) ?? null],
  )
  return { refreshToken }
}

/**
 * Atomic rotation (spec §4.3). The compare-and-set is ONE statement that only the current, live token can satisfy:
 * two concurrent requests presenting the same token serialise on the row lock, the second re-evaluates the WHERE after the
 * first commits, finds `replaced_at` set, and gets zero rows. Exactly one rotates. Never read-then-write.
 */
export async function rotateRefreshToken(
  refreshToken: unknown, userAgent?: string,
): Promise<{ uid: string; email: string; familyId: string; refreshToken: string }> {
  if (!plausible(refreshToken)) throw new SessionError('invalid')
  const hash = sha256Hex(refreshToken)
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    const won = await db.query(
      `UPDATE auth_sessions SET replaced_at = now(), last_used_at = now()
        WHERE refresh_hash = $1 AND replaced_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING uid, email, family_id`,
      [hash],
    )
    if (won.rowCount === 1) {
      const { uid, email, family_id: familyId } = won.rows[0]
      if (!isAmnexAccount(email)) {
        await db.query(REVOKE_FAMILY, [familyId])
        await db.query('COMMIT')
        throw new SessionError('not_amnex')
      }
      const next = randomToken()
      await db.query(
        `INSERT INTO auth_sessions (uid, email, refresh_hash, family_id, expires_at, user_agent)
         VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval, $6)`,
        [uid, email, sha256Hex(next), familyId, String(refreshTtlDays()), userAgent?.slice(0, 200) ?? null],
      )
      await db.query('COMMIT')
      return { uid, email, familyId, refreshToken: next }
    }
    // Did not rotate. A token that WAS rotated is a reuse: revoke the whole family. Anything else is just invalid.
    const seen = await db.query('SELECT family_id, replaced_at FROM auth_sessions WHERE refresh_hash = $1', [hash])
    if (seen.rows[0]?.replaced_at) {
      await db.query(REVOKE_FAMILY, [seen.rows[0].family_id])
      await db.query('COMMIT')
      throw new SessionError('reuse')
    }
    await db.query('ROLLBACK')
    throw new SessionError('invalid')
  } catch (e) {
    if (!(e instanceof SessionError)) await db.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    db.release()
  }
}

/** Logout. Idempotent and silent: an unknown token is indistinguishable from a revoked one. */
export async function revokeFamilyByRefreshToken(refreshToken: unknown): Promise<void> {
  if (!plausible(refreshToken)) return
  await pool.query(
    `UPDATE auth_sessions SET revoked_at = now()
      WHERE family_id = (SELECT family_id FROM auth_sessions WHERE refresh_hash = $1) AND revoked_at IS NULL`,
    [sha256Hex(refreshToken)],
  )
}
