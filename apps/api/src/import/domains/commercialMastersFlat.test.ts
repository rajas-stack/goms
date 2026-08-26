import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { validateFlatMasterRows, commitFlatMasterRows } from './commercialMastersFlat.js'
import { summarize } from '../engine.js'

describe('commercialMastersFlat importer', () => {
  beforeEach(async () => {
    await pool.query(
      `DELETE FROM commercial_masters WHERE master_key IN ('skuCategories','unitsOfMeasure','productEditions','billingTypes')`,
    )
  })

  it('creates a new SKU Category', async () => {
    const rows = [{ code: 'SW', name: 'Software', description: '', active: true, displayOrder: 0 }]
    const preview = await validateFlatMasterRows(pool, 'skuCategories', rows)
    expect(preview[0].action).toBe('create')
    expect(summarize(preview)).toMatchObject({ toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 0 })
  })

  it.each(['unitsOfMeasure', 'productEditions', 'billingTypes'] as const)(
    'creates a new %s row',
    async (sheetKey) => {
      const rows = [{ code: 'X1', name: 'X One', description: '', active: true, displayOrder: 0 }]
      const preview = await validateFlatMasterRows(pool, sheetKey, rows)
      expect(preview[0].action).toBe('create')
    },
  )

  it('keeps the four sheet keys isolated from each other (same Code, different sheets, no clash)', async () => {
    const rows = [{ code: 'X1', name: 'X One', description: '', active: true, displayOrder: 0 }]
    await commitFlatMasterRows(pool, 'unitsOfMeasure', rows, await validateFlatMasterRows(pool, 'unitsOfMeasure', rows))
    const preview = await validateFlatMasterRows(pool, 'productEditions', rows)
    expect(preview[0].action).toBe('create') // not blocked by unitsOfMeasure's row with the same Code
  })

  it('rejects a duplicate Code within the same uploaded sheet', async () => {
    const rows = [
      { code: 'SW', name: 'Software', description: '', active: true, displayOrder: 0 },
      { code: 'sw', name: 'Software Again', description: '', active: true, displayOrder: 1 },
    ]
    const preview = await validateFlatMasterRows(pool, 'skuCategories', rows)
    expect(preview[1].action).toBe('reject')
  })

  it('rejects a row missing a required field, naming the field', async () => {
    const rows = [{ code: '', name: 'Software', description: '', active: true, displayOrder: 0 }]
    const preview = await validateFlatMasterRows(pool, 'skuCategories', rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/code is required/i)
  })

  it('gives each of two blank-code rows its own "Code is required" error, not a false duplicate', async () => {
    const rows = [
      { code: '', name: 'First', description: '', active: true, displayOrder: 0 },
      { code: '', name: 'Second', description: '', active: true, displayOrder: 1 },
    ]
    const preview = await validateFlatMasterRows(pool, 'skuCategories', rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/code is required/i)
    expect(preview[1].action).toBe('reject')
    expect(preview[1].errors[0]).toMatch(/code is required/i)
  })

  it('classifies an unchanged row correctly on a second validate after commit', async () => {
    const rows = [{ code: 'SW', name: 'Software', description: '', active: true, displayOrder: 0 }]
    const preview = await validateFlatMasterRows(pool, 'skuCategories', rows)
    await commitFlatMasterRows(pool, 'skuCategories', rows, preview)
    const secondPreview = await validateFlatMasterRows(pool, 'skuCategories', rows)
    expect(summarize(secondPreview)).toMatchObject({ toCreate: 0, toUpdate: 0, unchanged: 1 })
  })

  it('classifies a changed name on an existing code as update, with a diff', async () => {
    const rows = [{ code: 'SW', name: 'Software', description: '', active: true, displayOrder: 0 }]
    const preview = await validateFlatMasterRows(pool, 'skuCategories', rows)
    await commitFlatMasterRows(pool, 'skuCategories', rows, preview)
    const changed = [{ ...rows[0], name: 'Software Products' }]
    const secondPreview = await validateFlatMasterRows(pool, 'skuCategories', changed)
    expect(secondPreview[0].action).toBe('update')
    expect(secondPreview[0].diff).toEqual([{ field: 'name', oldValue: 'Software', newValue: 'Software Products' }])
  })

  it('commits only create/update rows, never touching rejected ones', async () => {
    const rows = [
      { code: 'SW', name: 'Software', description: '', active: true, displayOrder: 0 },
      { code: '', name: 'Bad', description: '', active: true, displayOrder: 1 },
    ]
    const preview = await validateFlatMasterRows(pool, 'skuCategories', rows)
    await commitFlatMasterRows(pool, 'skuCategories', rows, preview)
    const result = await pool.query(`SELECT code FROM commercial_masters WHERE master_key='skuCategories'`)
    expect(result.rows.map((r) => r.code)).toEqual(['SW'])
  })

  it('stores no extra fields (extra stays an empty object) for a committed row', async () => {
    const rows = [{ code: 'SW', name: 'Software', description: '', active: true, displayOrder: 0 }]
    const preview = await validateFlatMasterRows(pool, 'skuCategories', rows)
    await commitFlatMasterRows(pool, 'skuCategories', rows, preview)
    const result = await pool.query(`SELECT extra FROM commercial_masters WHERE master_key='skuCategories' AND code='SW'`)
    expect(result.rows[0].extra).toEqual({})
  })
})
