import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { validateApprovalMatrixRows, commitApprovalMatrixRows } from './approvalMatrix.js'
import { summarize } from '../engine.js'

describe('approvalMatrix importer', () => {
  beforeEach(async () => {
    // Same cross-file-leftover reason as taxClasses.test.ts — commercial_skus
    // references commercial_masters ON DELETE RESTRICT.
    await pool.query('DELETE FROM commercial_audit_logs')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM commercial_bom_items')
    await pool.query('DELETE FROM commercial_skus')
    await pool.query(`DELETE FROM commercial_masters WHERE master_key='approvalMatrix'`)
  })

  // --- Baseline CRUD classification (mirrors taxClasses/commercialMastersFlat conventions) ---

  it('classifies a brand-new code as create', async () => {
    const rows = [
      { code: 'AM1', name: '0-10%', description: '', minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: '', allowAutoApproval: true, active: true, displayOrder: 0 },
    ]
    const preview = await validateApprovalMatrixRows(pool, rows)
    expect(summarize(preview)).toMatchObject({ toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 0 })
  })

  it('rejects a row missing a required field, naming the field', async () => {
    const rows = [
      { code: '', name: '0-10%', description: '', minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: '', allowAutoApproval: true, active: true, displayOrder: 0 },
    ]
    const preview = await validateApprovalMatrixRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/code is required/i)
  })

  it('rejects a non-numeric Max Discount %', async () => {
    const rows = [
      { code: 'AM1', name: '0-10%', description: '', minDiscountPct: 0, maxDiscountPct: 'ten' as any, approvalLevelLabel: '', allowAutoApproval: true, active: true, displayOrder: 0 },
    ]
    const preview = await validateApprovalMatrixRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/maxDiscountPct/i)
  })

  it('rejects a band whose Min Discount % is not less than its Max Discount %', async () => {
    const rows = [
      { code: 'AM1', name: 'Bad band', description: '', minDiscountPct: 20, maxDiscountPct: 20, approvalLevelLabel: '', allowAutoApproval: true, active: true, displayOrder: 0 },
    ]
    const preview = await validateApprovalMatrixRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/maxDiscountPct must be greater than minDiscountPct/i)
  })

  it('classifies an unchanged row correctly on a second validate after commit', async () => {
    const rows = [
      { code: 'AM1', name: '0-10%', description: '', minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: '', allowAutoApproval: true, active: true, displayOrder: 0 },
    ]
    const preview = await validateApprovalMatrixRows(pool, rows)
    await commitApprovalMatrixRows(pool, rows, preview)
    const secondPreview = await validateApprovalMatrixRows(pool, rows)
    expect(summarize(secondPreview)).toMatchObject({ toCreate: 0, toUpdate: 0, unchanged: 1 })
  })

  it('classifies a changed band as update, with a diff', async () => {
    const rows = [
      { code: 'AM1', name: '0-10%', description: '', minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: '', allowAutoApproval: true, active: true, displayOrder: 0 },
    ]
    const preview = await validateApprovalMatrixRows(pool, rows)
    await commitApprovalMatrixRows(pool, rows, preview)
    const changed = [{ ...rows[0], approvalLevelLabel: 'Regional Manager' }]
    const secondPreview = await validateApprovalMatrixRows(pool, changed)
    expect(secondPreview[0].action).toBe('update')
    expect(secondPreview[0].diff).toEqual([{ field: 'approvalLevelLabel', oldValue: '', newValue: 'Regional Manager' }])
  })

  it('commits only create/update rows, never touching rejected ones', async () => {
    const rows = [
      { code: 'AM1', name: '0-10%', description: '', minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: '', allowAutoApproval: true, active: true, displayOrder: 0 },
      { code: '', name: 'Bad', description: '', minDiscountPct: 10, maxDiscountPct: 20, approvalLevelLabel: '', allowAutoApproval: false, active: true, displayOrder: 1 },
    ]
    const preview = await validateApprovalMatrixRows(pool, rows)
    await commitApprovalMatrixRows(pool, rows, preview)
    const result = await pool.query(`SELECT code FROM commercial_masters WHERE master_key='approvalMatrix'`)
    expect(result.rows.map((r) => r.code)).toEqual(['AM1'])
  })

  it('stores the four extra JSONB fields for a committed band', async () => {
    const rows = [
      { code: 'AM1', name: '0-10%', description: '', minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: 'Sales Manager', allowAutoApproval: true, active: true, displayOrder: 0 },
    ]
    const preview = await validateApprovalMatrixRows(pool, rows)
    await commitApprovalMatrixRows(pool, rows, preview)
    const result = await pool.query(`SELECT extra FROM commercial_masters WHERE master_key='approvalMatrix' AND code='AM1'`)
    expect(result.rows[0].extra).toEqual({
      minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: 'Sales Manager', allowAutoApproval: true,
    })
  })

  // --- New band-contiguity business rule (genuinely new — not enforced by commercial.ts today) ---

  it('rejects the batch when bands leave a gap', async () => {
    const rows = [
      { code: 'AM1', name: '0-10%', description: '', minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: '', allowAutoApproval: true, active: true, displayOrder: 0 },
      { code: 'AM2', name: '20-50%', description: '', minDiscountPct: 20, maxDiscountPct: 50, approvalLevelLabel: 'CEO', allowAutoApproval: false, active: true, displayOrder: 1 },
    ]
    const preview = await validateApprovalMatrixRows(pool, rows)
    expect(preview.every((r) => r.action === 'reject')).toBe(true)
    expect(preview[0].errors[0]).toMatch(/gap between 10% and 20%/i)
  })

  it('accepts a contiguous, gap-free set of bands from 0 to 90', async () => {
    const rows = [
      { code: 'AM1', name: '0-10%', description: '', minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: '', allowAutoApproval: true, active: true, displayOrder: 0 },
      { code: 'AM2', name: '10-30%', description: '', minDiscountPct: 10, maxDiscountPct: 30, approvalLevelLabel: 'Manager', allowAutoApproval: false, active: true, displayOrder: 1 },
      { code: 'AM3', name: '30-60%', description: '', minDiscountPct: 30, maxDiscountPct: 60, approvalLevelLabel: 'Director', allowAutoApproval: false, active: true, displayOrder: 2 },
      { code: 'AM4', name: '60-90%', description: '', minDiscountPct: 60, maxDiscountPct: 90, approvalLevelLabel: 'CEO', allowAutoApproval: false, active: true, displayOrder: 3 },
    ]
    const preview = await validateApprovalMatrixRows(pool, rows)
    expect(preview.every((r) => r.action === 'create')).toBe(true)
    expect(summarize(preview)).toMatchObject({ toCreate: 4, rejected: 0 })
  })

  it('rejects overlapping bands, naming the overlapping range', async () => {
    const rows = [
      { code: 'AM1', name: '0-20%', description: '', minDiscountPct: 0, maxDiscountPct: 20, approvalLevelLabel: '', allowAutoApproval: true, active: true, displayOrder: 0 },
      { code: 'AM2', name: '10-30%', description: '', minDiscountPct: 10, maxDiscountPct: 30, approvalLevelLabel: 'CEO', allowAutoApproval: false, active: true, displayOrder: 1 },
    ]
    const preview = await validateApprovalMatrixRows(pool, rows)
    expect(preview.every((r) => r.action === 'reject')).toBe(true)
    expect(preview[0].errors[0]).toMatch(/overlap/i)
    expect(preview[0].errors[0]).toContain('10%')
    expect(preview[0].errors[0]).toContain('20%')
  })

  it('rejects a first band whose Min Discount % is not 0', async () => {
    const rows = [
      { code: 'AM1', name: '5-50%', description: '', minDiscountPct: 5, maxDiscountPct: 50, approvalLevelLabel: 'CEO', allowAutoApproval: false, active: true, displayOrder: 0 },
    ]
    const preview = await validateApprovalMatrixRows(pool, rows)
    expect(preview.every((r) => r.action === 'reject')).toBe(true)
    expect(preview[0].errors[0]).toMatch(/must be 0/i)
    expect(preview[0].errors[0]).toContain('5%')
  })

  it('excludes an inactive existing band from the contiguity check when retiring it', async () => {
    const initial = [
      { code: 'AM1', name: '0-10%', description: '', minDiscountPct: 0, maxDiscountPct: 10, approvalLevelLabel: '', allowAutoApproval: true, active: true, displayOrder: 0 },
      { code: 'AM2', name: '10-50%', description: '', minDiscountPct: 10, maxDiscountPct: 50, approvalLevelLabel: 'CEO', allowAutoApproval: false, active: true, displayOrder: 1 },
    ]
    const initialPreview = await validateApprovalMatrixRows(pool, initial)
    expect(initialPreview.every((r) => r.action === 'create')).toBe(true)
    await commitApprovalMatrixRows(pool, initial, initialPreview)

    // Retire AM2 (10-50%) by setting Active=false. AM1 (0-10%) is not part of
    // this batch at all — it stays active in the DB, covering only 0-10.
    // Without the exclusion, the now-orphaned 10-50 range would look like an
    // uncovered gap and incorrectly block this retirement.
    const retireBatch = [{ ...initial[1], active: false }]
    const preview = await validateApprovalMatrixRows(pool, retireBatch)
    expect(preview[0].action).toBe('update')
    expect(preview[0].errors).toEqual([])

    await commitApprovalMatrixRows(pool, retireBatch, preview)
    const result = await pool.query(
      `SELECT code, active FROM commercial_masters WHERE master_key='approvalMatrix' ORDER BY code`,
    )
    expect(result.rows).toEqual([
      { code: 'AM1', active: true },
      { code: 'AM2', active: false },
    ])
  })
})
