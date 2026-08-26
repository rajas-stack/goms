import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { validateTaxClassRows, commitTaxClassRows } from './taxClasses.js'
import { summarize } from '../engine.js'

describe('taxClasses importer', () => {
  beforeEach(async () => {
    // This suite runs sequentially against one shared real Postgres
    // (vitest.config.ts's fileParallelism:false) — commercial_skus
    // references commercial_masters (including taxClasses rows) ON DELETE
    // RESTRICT (default), so a leftover SKU row from another test file
    // could block the delete below unless cleared first, same convention
    // commercial.test.ts's own beforeEach already establishes.
    await pool.query('DELETE FROM commercial_audit_logs')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM commercial_bom_items')
    await pool.query('DELETE FROM commercial_skus')
    await pool.query(`DELETE FROM commercial_masters WHERE master_key='taxClasses'`)
  })

  it('classifies a brand-new code as create', async () => {
    const rows = [{ code: 'GST18', name: 'GST 18%', description: '', ratePct: 18, active: true, displayOrder: 0 }]
    const preview = await validateTaxClassRows(pool, rows)
    expect(summarize(preview)).toMatchObject({ toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 0 })
  })

  it('rejects a row missing a required field, naming the field', async () => {
    const rows = [{ code: '', name: 'GST 18%', description: '', ratePct: 18, active: true, displayOrder: 0 }]
    const preview = await validateTaxClassRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/code is required/i)
  })

  it('rejects a non-numeric rate', async () => {
    const rows = [{ code: 'GST18', name: 'GST 18%', description: '', ratePct: 'eighteen' as any, active: true, displayOrder: 0 }]
    const preview = await validateTaxClassRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/ratePct/i)
  })

  it('classifies an unchanged row correctly on a second validate after commit', async () => {
    const rows = [{ code: 'GST18', name: 'GST 18%', description: '', ratePct: 18, active: true, displayOrder: 0 }]
    const preview = await validateTaxClassRows(pool, rows)
    await commitTaxClassRows(pool, rows, preview)
    const secondPreview = await validateTaxClassRows(pool, rows)
    expect(summarize(secondPreview)).toMatchObject({ toCreate: 0, toUpdate: 0, unchanged: 1 })
  })

  it('classifies a changed rate on an existing code as update, with a diff', async () => {
    const rows = [{ code: 'GST18', name: 'GST 18%', description: '', ratePct: 18, active: true, displayOrder: 0 }]
    const preview = await validateTaxClassRows(pool, rows)
    await commitTaxClassRows(pool, rows, preview)
    const changed = [{ ...rows[0], ratePct: 20 }]
    const secondPreview = await validateTaxClassRows(pool, changed)
    expect(secondPreview[0].action).toBe('update')
    expect(secondPreview[0].diff).toEqual([{ field: 'ratePct', oldValue: 18, newValue: 20 }])
  })

  it('gives each of two blank-code rows its own "Code is required" error, not a false duplicate', async () => {
    const rows = [
      { code: '', name: 'First', description: '', ratePct: 1, active: true, displayOrder: 0 },
      { code: '', name: 'Second', description: '', ratePct: 2, active: true, displayOrder: 1 },
    ]
    const preview = await validateTaxClassRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/code is required/i)
    expect(preview[1].action).toBe('reject')
    expect(preview[1].errors[0]).toMatch(/code is required/i)
  })

  it('commits only create/update rows, never touching rejected ones', async () => {
    const rows = [
      { code: 'GST18', name: 'GST 18%', description: '', ratePct: 18, active: true, displayOrder: 0 },
      { code: '', name: 'Bad', description: '', ratePct: 5, active: true, displayOrder: 1 },
    ]
    const preview = await validateTaxClassRows(pool, rows)
    await commitTaxClassRows(pool, rows, preview)
    const result = await pool.query(`SELECT code FROM commercial_masters WHERE master_key='taxClasses'`)
    expect(result.rows.map((r) => r.code)).toEqual(['GST18'])
  })
})
