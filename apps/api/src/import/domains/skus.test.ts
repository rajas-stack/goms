import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { validateSkuRows, commitSkuRows } from './skus.js'
import { summarize } from '../engine.js'

describe('skus importer', () => {
  beforeEach(async () => {
    // This suite runs sequentially against one shared real Postgres
    // (vitest.config.ts's fileParallelism:false) — cleared in the exact
    // order commercial.test.ts's own beforeEach establishes, so a leftover
    // row from another test file never blocks these deletes via an
    // ON DELETE RESTRICT FK.
    await pool.query('DELETE FROM commercial_audit_logs')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM commercial_bom_items')
    await pool.query('DELETE FROM commercial_skus')
    await pool.query('DELETE FROM edition_features')
    await pool.query('DELETE FROM commercial_masters')
  })

  async function insertMaster(masterKey: string, code: string): Promise<string> {
    const result = await pool.query(
      `INSERT INTO commercial_masters (master_key, code, name) VALUES ($1,$2,$3) RETURNING id`,
      [masterKey, code, code],
    )
    return result.rows[0].id
  }

  /** One row of every master kind a commercial_skus row's 6 required FK
   *  columns need, plus the STD edition the "blank Edition Code" test
   *  depends on. */
  async function makeSupportingMasters() {
    return {
      category: await insertMaster('skuCategories', 'SW'),
      feature: await insertMaster('features', 'F1'),
      edition: await insertMaster('productEditions', 'STD'),
      uom: await insertMaster('unitsOfMeasure', 'LIC'),
      currency: await insertMaster('currencies', 'INR'),
      taxClass: await insertMaster('taxClasses', 'GST18'),
      billingType: await insertMaster('billingTypes', 'OT'),
    }
  }

  function baseRow(overrides: Record<string, unknown> = {}) {
    return {
      skuCode: 'X-1',
      name: 'X',
      categoryCode: 'SW',
      featureCode: 'F1',
      editionCode: 'STD',
      uomCode: 'LIC',
      currencyCode: 'INR',
      taxClassCode: 'GST18',
      billingTypeCode: 'OT',
      activeFrom: '2026-01-01',
      minimumAllowedPrice: 100,
      ...overrides,
    }
  }

  // --- representative test (verbatim from the plan) -------------------------

  it('rejects a SKU whose Category Code does not resolve to an existing skuCategories row', async () => {
    await makeSupportingMasters()
    const rows = [baseRow({ categoryCode: 'GHOST' })]
    const preview = await validateSkuRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/no such sku category code: GHOST/i)
  })

  // --- named remaining tests --------------------------------------------------

  it('defaults Edition Code to the STD edition when blank', async () => {
    const masters = await makeSupportingMasters()
    const rows = [baseRow({ editionCode: '' })]
    const preview = await validateSkuRows(pool, rows)
    expect(preview[0].action).toBe('create')
    await commitSkuRows(pool, rows, preview)
    const result = await pool.query('SELECT edition_id FROM commercial_skus WHERE sku_code=$1', ['X-1'])
    expect(result.rows[0].edition_id).toBe(masters.edition)
  })

  it('creates a fully-specified SKU when every FK code resolves', async () => {
    await makeSupportingMasters()
    const rows = [baseRow()]
    const preview = await validateSkuRows(pool, rows)
    expect(preview[0].action).toBe('create')
    expect(summarize(preview)).toMatchObject({ toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 0 })
    await commitSkuRows(pool, rows, preview)
    const result = await pool.query('SELECT sku_code, name FROM commercial_skus WHERE sku_code=$1', ['X-1'])
    expect(result.rows[0]).toMatchObject({ sku_code: 'X-1', name: 'X' })
  })

  it('rejects when Minimum Allowed Price is missing', async () => {
    await makeSupportingMasters()
    const row = baseRow()
    delete (row as Record<string, unknown>).minimumAllowedPrice
    const preview = await validateSkuRows(pool, [row])
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors.join(' ')).toMatch(/minimumAllowedPrice/i)
  })

  it('a re-imported identical SKU row is classified unchanged', async () => {
    await makeSupportingMasters()
    const rows = [baseRow()]
    const preview = await validateSkuRows(pool, rows)
    await commitSkuRows(pool, rows, preview)
    const secondPreview = await validateSkuRows(pool, rows)
    expect(summarize(secondPreview)).toMatchObject({ toCreate: 0, toUpdate: 0, unchanged: 1, rejected: 0 })
  })

  it('changing a pricing field on an existing SKU Code is classified update with a diff', async () => {
    await makeSupportingMasters()
    const rows = [baseRow({ listPrice: 1000 })]
    const preview = await validateSkuRows(pool, rows)
    await commitSkuRows(pool, rows, preview)
    const changed = [baseRow({ listPrice: 1200 })]
    const secondPreview = await validateSkuRows(pool, changed)
    expect(secondPreview[0].action).toBe('update')
    expect(secondPreview[0].diff).toEqual([{ field: 'listPrice', oldValue: 1000, newValue: 1200 }])
  })

  // --- additional coverage beyond the plan's named list ----------------------

  it('rejects a row missing a required field, naming the field', async () => {
    await makeSupportingMasters()
    const row = baseRow({ skuCode: '' })
    const preview = await validateSkuRows(pool, [row])
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/sku code is required/i)
  })

  it('commits only create/update rows, never touching rejected ones', async () => {
    await makeSupportingMasters()
    const rows = [baseRow(), baseRow({ skuCode: 'X-2', categoryCode: 'GHOST' })]
    const preview = await validateSkuRows(pool, rows)
    await commitSkuRows(pool, rows, preview)
    const result = await pool.query('SELECT sku_code FROM commercial_skus')
    expect(result.rows.map((r) => r.sku_code)).toEqual(['X-1'])
  })

  it('suggests a fuzzy candidate for a near-miss Category Code', async () => {
    await makeSupportingMasters()
    // makeSupportingMasters' own 'SW' category is only 2 chars — slicing one
    // char off drops below MIN_FUZZY_SIMILARITY's floor for a 2-char string.
    // A dedicated longer category code makes the near-miss realistic.
    await insertMaster('skuCategories', 'SWTEST')
    const rows = [baseRow({ skuCode: 'SKU-FUZZY', categoryCode: 'SWTES' })]
    const preview = await validateSkuRows(pool, rows)
    expect(preview[0].action).toBe('needs-review')
    expect(preview[0].candidates?.[0].key).toBe('SWTEST')
  })
})
