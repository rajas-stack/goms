import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { runner } from 'node-pg-migrate'
import { pool } from './db.js'

/** node-pg-migrate refuses to run a migration whose name sorts BEFORE one that is already applied ("Not run migration X is preceding already run
 *  migration Y"). So a migration's file number is a deployment decision, not a label. Production's applied history now ends at
 *  1791764800000_amnex-departments (release 8, 59 migrations), so the google_sub link is numbered ABOVE it. The first number chosen for it
 *  (1791763850000, from before release 8) would now be refused by production; the control test below pins that failure.
 *  Verified against the real runner on throwaway DBs. */
const DIR = fileURLToPath(new URL('../migrations', import.meta.url))
const LINK = '1791764900000_google-integration-sub-link.sql'
const SUPERSEDED = '1791763850000_google-integration-sub-link.sql'
const PROD_LAST = '1791764800000_amnex-departments.sql'
const NEXT = '1791765000000_next-release.sql'
const STUB = '-- Up Migration\nSELECT 1;\n-- Down Migration\nSELECT 1;\n'
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()

describe('migration file order', () => {
  it('every migration has a unique 13-digit number and a lowercase-kebab name', () => {
    expect(files.every((f) => /^\d{13}_[a-z0-9-]+\.sql$/.test(f))).toBe(true)
    expect(new Set(files.map((f) => f.slice(0, 13))).size).toBe(files.length)
  })

  it("the link sorts after the migration that creates its table AND after production's last applied migration", () => {
    expect(files).toContain(LINK)
    expect(files).toContain('1791763800000_google-integrations.sql')
    expect(files).toContain(PROD_LAST)
    expect(LINK > PROD_LAST).toBe(true)
    expect(files).not.toContain(SUPERSEDED)
  })
})

describe('real node-pg-migrate order check', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'goms-order-'))
  const tables: string[] = []
  afterAll(async () => {
    for (const t of tables) await pool.query(`DROP TABLE IF EXISTS ${t}`)
    rmSync(work, { recursive: true, force: true })
  })

  /** A migrations dir holding only production's last applied migration (a no-op stub): the state production is in. */
  function prodState(name: string): string {
    const dir = path.join(work, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, PROD_LAST), STUB)
    return dir
  }
  /** Production's last migration (stub), the link under `linkName` (its REAL, idempotent SQL), then any `later` stubs. */
  function dirWith(name: string, linkName: string, later: string[]): string {
    const dir = prodState(name)
    copyFileSync(path.join(DIR, LINK), path.join(dir, linkName))
    for (const l of later) writeFileSync(path.join(dir, l), STUB)
    return dir
  }
  const up = async (dir: string, table: string) => {
    const db = await pool.connect()
    try {
      return await runner({ dbClient: db, dir, direction: 'up', migrationsTable: table, log: () => {}, logger: { debug() {}, info() {}, warn() {}, error() {} } })
    } finally { db.release() }
  }

  it("applies cleanly on top of production's history, and a later release still applies after it", async () => {
    const table = 'pgmigrations_order_ok'; tables.push(table)
    await up(prodState('ok0'), table) // production state: last applied = amnex-departments
    const applied = await up(dirWith('ok1', LINK, [NEXT]), table)
    expect(applied.map((m) => m.name)).toEqual([LINK, NEXT].map((l) => l.replace(/\.sql$/, '')))
  })

  it("control: the superseded pre-release-8 number is refused once production's last migration is applied (the failure this renumbering avoids)", async () => {
    const table = 'pgmigrations_order_bad'; tables.push(table)
    await up(prodState('bad0'), table)
    await expect(up(dirWith('bad1', SUPERSEDED, []), table)).rejects.toThrow(/preceding already run migration/)
  })
})
