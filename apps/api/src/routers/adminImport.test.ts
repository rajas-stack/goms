import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('adminImport router', () => {
  beforeEach(async () => {
    process.env.ADMIN_IMPORT_ENABLED = 'true'
    await pool.query(`DELETE FROM commercial_masters WHERE master_key='taxClasses'`)
  })
  afterEach(() => {
    delete process.env.ADMIN_IMPORT_ENABLED
  })

  it('validate returns a create-classified preview and a commit token', async () => {
    const caller = appRouter.createCaller({})
    const rows = [{ code: 'GST18', name: 'GST 18%', ratePct: 18 }]
    const preview = await caller.adminImport.validate({ domain: 'taxClasses', rows })
    expect(preview.summary).toMatchObject({ toCreate: 1, total: 1 })
    expect(typeof preview.commitToken).toBe('string')
  })

  it('commit with a valid token writes the row and returns the summary', async () => {
    const caller = appRouter.createCaller({})
    const rows = [{ code: 'GST18', name: 'GST 18%', ratePct: 18 }]
    const preview = await caller.adminImport.validate({ domain: 'taxClasses', rows })
    const result = await caller.adminImport.commit({ domain: 'taxClasses', commitToken: preview.commitToken, rows })
    expect(result.summary.toCreate).toBe(1)
    const dbRows = await pool.query(`SELECT code FROM commercial_masters WHERE master_key='taxClasses'`)
    expect(dbRows.rows.map((r) => r.code)).toEqual(['GST18'])
  })

  it('commit rejects a stale token when the rows changed since preview', async () => {
    const caller = appRouter.createCaller({})
    const preview = await caller.adminImport.validate({ domain: 'taxClasses', rows: [{ code: 'GST18', name: 'A', ratePct: 18 }] })
    await expect(
      caller.adminImport.commit({ domain: 'taxClasses', commitToken: preview.commitToken, rows: [{ code: 'GST18', name: 'B', ratePct: 18 }] }),
    ).rejects.toThrow()
  })

  it('listDomains reports the current taxClasses row count', async () => {
    const caller = appRouter.createCaller({})
    const rows = [{ code: 'GST18', name: 'A', ratePct: 18 }]
    const preview = await caller.adminImport.validate({ domain: 'taxClasses', rows })
    await caller.adminImport.commit({ domain: 'taxClasses', commitToken: preview.commitToken, rows })
    const domains = await caller.adminImport.listDomains()
    expect(domains.find((d) => d.domain === 'taxClasses')?.currentRowCount).toBe(1)
  })

  it('validate for an unwired domain throws NOT_IMPLEMENTED', async () => {
    const caller = appRouter.createCaller({})
    await expect(caller.adminImport.validate({ domain: 'employees', rows: [] })).rejects.toThrow()
  })

  it('rejects a request over MAX_IMPORT_ROWS', async () => {
    const caller = appRouter.createCaller({})
    const rows = Array.from({ length: 5001 }, (_, i) => ({ code: `T${i}`, name: 'X', ratePct: 1 }))
    await expect(caller.adminImport.validate({ domain: 'taxClasses', rows })).rejects.toThrow()
  })
})
