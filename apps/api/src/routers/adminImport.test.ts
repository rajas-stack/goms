import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('adminImport router', () => {
  beforeEach(async () => {
    process.env.ADMIN_IMPORT_ENABLED = 'true'
    // Cleared in the established cross-file-safe order (see the 2026-08-26
    // "clear FK-dependent tables" fix) since this file exercises several
    // domains that touch commercial_masters/sales_persons/hierarchy_nodes.
    await pool.query('DELETE FROM commercial_audit_logs')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM commercial_bom_items')
    await pool.query('DELETE FROM commercial_skus')
    await pool.query('DELETE FROM edition_features')
    await pool.query('DELETE FROM commercial_masters')
    await pool.query('DELETE FROM sales_persons')
    await pool.query('DELETE FROM admin_import_runs')
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

  it('commit with a valid token writes the row, records an audit run, and returns the summary', async () => {
    const caller = appRouter.createCaller({})
    const rows = [{ code: 'GST18', name: 'GST 18%', ratePct: 18 }]
    const preview = await caller.adminImport.validate({ domain: 'taxClasses', rows })
    const result = await caller.adminImport.commit({ domain: 'taxClasses', commitToken: preview.commitToken, rows })
    expect(result.summary.toCreate).toBe(1)
    const dbRows = await pool.query(`SELECT code FROM commercial_masters WHERE master_key='taxClasses'`)
    expect(dbRows.rows.map((r) => r.code)).toEqual(['GST18'])

    const history = await caller.adminImport.history({ domain: 'taxClasses' })
    expect(history).toHaveLength(1)
    expect(history[0].summary.toCreate).toBe(1)
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

  it('rejects a request over MAX_IMPORT_ROWS', async () => {
    const caller = appRouter.createCaller({})
    const rows = Array.from({ length: 5001 }, (_, i) => ({ code: `T${i}`, name: 'X', ratePct: 1 }))
    await expect(caller.adminImport.validate({ domain: 'taxClasses', rows })).rejects.toThrow()
  })

  it('routes a multi-sheet domain (commercialMastersFlat) through the { sheet: rows[] } adapter end-to-end', async () => {
    const caller = appRouter.createCaller({})
    const rows = {
      skuCategories: [{ code: 'SW', name: 'Software', description: '', active: true, displayOrder: 0 }],
      unitsOfMeasure: [{ code: 'LIC', name: 'License', description: '', active: true, displayOrder: 0 }],
      productEditions: [],
      billingTypes: [],
    }
    const preview = await caller.adminImport.validate({ domain: 'commercialMastersFlat', rows })
    // Flattened across all 4 sheets: 2 rows submitted, both create.
    expect(preview.summary).toMatchObject({ toCreate: 2, total: 2 })

    const result = await caller.adminImport.commit({ domain: 'commercialMastersFlat', commitToken: preview.commitToken, rows })
    expect(result.summary.toCreate).toBe(2)
    const dbRows = await pool.query(
      `SELECT master_key, code FROM commercial_masters WHERE master_key IN ('skuCategories','unitsOfMeasure') ORDER BY master_key`,
    )
    expect(dbRows.rows).toEqual([
      { master_key: 'skuCategories', code: 'SW' },
      { master_key: 'unitsOfMeasure', code: 'LIC' },
    ])
  })

  it('routes a two-sheet domain (salesRoster) through the {persons,postings} adapter end-to-end', async () => {
    const caller = appRouter.createCaller({})
    const rows = {
      persons: [{ officialEmail: 'a@amnex.com', name: 'A', personalEmail: '', mobile: '', altMobile: '', joinedOn: null, status: 'active' }],
      postings: [{ salesPersonEmail: 'a@amnex.com', designation: 'X', tierKey: 'accountManager', managerEmail: null, office: '', startDate: '2026-01-01', reason: '' }],
    }
    const preview = await caller.adminImport.validate({ domain: 'salesRoster', rows })
    expect(preview.summary).toMatchObject({ toCreate: 2, total: 2 })

    const result = await caller.adminImport.commit({ domain: 'salesRoster', commitToken: preview.commitToken, rows })
    expect(result.summary.toCreate).toBe(2)
    const dbRows = await pool.query(`SELECT official_email FROM sales_persons`)
    expect(dbRows.rows).toEqual([{ official_email: 'a@amnex.com' }])
  })
})
