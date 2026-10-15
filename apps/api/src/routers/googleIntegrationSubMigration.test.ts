import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pool } from '../db.js'

/** Migration 1791764900000_google-integration-sub-link: additive, idempotent, reversible, and safe for rows that already exist. Every DDL
 *  statement here runs inside a transaction that is rolled back, so the shared test database is left exactly as it was found. */
const FILE = fileURLToPath(new URL('../../migrations/1791764900000_google-integration-sub-link.sql', import.meta.url))
const sql = readFileSync(FILE, 'utf8')
const [upPart, downPart] = sql.split(/^-- Down Migration\s*$/m)
const UP = upPart.replace(/^-- Up Migration\s*$/m, '')
const DOWN = downPart

async function inRolledBackTx<T>(fn: (q: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>): Promise<T> {
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    return await fn((text, params) => db.query(text, params))
  } finally {
    await db.query('ROLLBACK').catch(() => {})
    db.release()
  }
}
const column = (q: Parameters<Parameters<typeof inRolledBackTx>[0]>[0]) =>
  q(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name='google_integration_settings' AND column_name='google_sub'`).then((r) => r.rows[0])
const indexDef = (q: Parameters<Parameters<typeof inRolledBackTx>[0]>[0]) =>
  q(`SELECT indexdef FROM pg_indexes WHERE tablename='google_integration_settings' AND indexname='google_integration_settings_google_sub_key'`).then((r) => r.rows[0]?.indexdef as string | undefined)

describe('migration 1791764900000 (google_sub link)', () => {
  it('is additive: only ADD COLUMN IF NOT EXISTS and CREATE UNIQUE INDEX IF NOT EXISTS on this one table, and no email-based anything', () => {
    const statements = UP.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toMatch(/^ALTER TABLE google_integration_settings ADD COLUMN IF NOT EXISTS google_sub TEXT$/)
    expect(statements[1]).toMatch(/^CREATE UNIQUE INDEX IF NOT EXISTS google_integration_settings_google_sub_key\s+ON google_integration_settings \(google_sub\) WHERE google_sub IS NOT NULL$/)
    expect(UP).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|INSERT)\b/i)
    expect(UP.replace(/--.*$/gm, '')).not.toMatch(/email/i)
  })

  it('has been applied to the test database: a nullable TEXT column and the partial unique index', async () => {
    await inRolledBackTx(async (q) => {
      expect(await column(q)).toEqual({ data_type: 'text', is_nullable: 'YES' })
      expect(await indexDef(q)).toMatch(/UNIQUE.*\(google_sub\) WHERE \(google_sub IS NOT NULL\)/)
    })
  })

  it('is idempotent: running the Up part again changes nothing and does not fail', async () => {
    await inRolledBackTx(async (q) => {
      await q(UP)
      await q(UP)
      expect(await column(q)).toEqual({ data_type: 'text', is_nullable: 'YES' })
    })
  })

  it('is reversible: Down removes the column and index, Up restores them, and old-style rows work in between', async () => {
    await inRolledBackTx(async (q) => {
      await q(DOWN)
      expect(await column(q)).toBeUndefined()
      expect(await indexDef(q)).toBeUndefined()
      // pre-link code's exact statements still work without the column
      await q(`INSERT INTO google_integration_settings (user_uid,email,settings) VALUES ('mig-old','mig@amnex.com','{}')`)
      expect((await q(`SELECT settings FROM google_integration_settings WHERE user_uid='mig-old'`)).rows).toHaveLength(1)
      await q(UP)
      expect(await column(q)).toEqual({ data_type: 'text', is_nullable: 'YES' })
    })
  })

  it('leaves rows that existed before the migration intact (google_sub NULL, uid/email/settings/updated_at unchanged)', async () => {
    await inRolledBackTx(async (q) => {
      await q(DOWN)
      await q(`INSERT INTO google_integration_settings (user_uid,email,settings,updated_at) VALUES ('mig-pre','Mig.Pre@amnex.com','{"docsId":"d1"}','2026-01-02T03:04:05Z')`)
      await q(UP)
      const row = (await q(`SELECT user_uid,email,settings,google_sub,updated_at FROM google_integration_settings WHERE user_uid='mig-pre'`)).rows[0]
      expect(row).toMatchObject({ user_uid: 'mig-pre', email: 'Mig.Pre@amnex.com', settings: { docsId: 'd1' }, google_sub: null })
      expect(new Date(row.updated_at).toISOString()).toBe('2026-01-02T03:04:05.000Z')
    })
  })

  it('allows many unstamped rows but never two rows for the same sub', async () => {
    await inRolledBackTx(async (q) => {
      const ins = (uid: string, sub: string | null) => q(`INSERT INTO google_integration_settings (user_uid,email,settings,google_sub) VALUES ($1,'x@amnex.com','{}',$2)`, [uid, sub])
      await ins('mig-n1', null); await ins('mig-n2', null); await ins('mig-n3', null)
      await ins('mig-s1', '777')
      await expect(ins('mig-s2', '777')).rejects.toThrow(/unique|duplicate/i)
    })
  })
})
