import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { validateBomRows, commitBomRows } from './bom.js'
import { summarize } from '../engine.js'

describe('bom importer', () => {
  beforeEach(async () => {
    // This suite runs sequentially against one shared real Postgres
    // (vitest.config.ts's fileParallelism:false) — no per-file isolation.
    // Cleared in this order (copied verbatim from commercial.test.ts's own
    // beforeEach) so a leftover row from another test file's fixtures never
    // blocks this suite's own deletes via an ON DELETE RESTRICT FK.
    await pool.query('DELETE FROM commercial_audit_logs')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM commercial_bom_items')
    await pool.query('DELETE FROM commercial_skus')
    await pool.query('DELETE FROM edition_features')
    await pool.query('DELETE FROM commercial_masters')
  })

  // --- fixture helpers ------------------------------------------------------

  /** Inserts one row of each master kind a commercial_skus row's FK columns
   *  require, directly via SQL (no need to route through the real Vertical
   *  -> Product -> Module -> Feature hierarchy the commercial.skus router
   *  builds — bom.ts's own validation only ever looks at commercial_skus
   *  .sku_code, never at a SKU's own referential correctness). */
  async function makeSupportingMasters() {
    const insertMaster = async (masterKey: string, code: string): Promise<string> => {
      const result = await pool.query(
        `INSERT INTO commercial_masters (master_key, code, name) VALUES ($1,$2,$3) RETURNING id`,
        [masterKey, code, code],
      )
      return result.rows[0].id
    }
    return {
      category: await insertMaster('skuCategories', 'STD'),
      feature: await insertMaster('features', 'F1'),
      edition: await insertMaster('productEditions', 'STD'),
      uom: await insertMaster('unitsOfMeasure', 'LIC'),
      currency: await insertMaster('currencies', 'INR'),
      taxClass: await insertMaster('taxClasses', 'GST18'),
      billingType: await insertMaster('billingTypes', 'OT'),
    }
  }

  async function insertSku(masters: Awaited<ReturnType<typeof makeSupportingMasters>>, skuCode: string): Promise<string> {
    const result = await pool.query(
      `INSERT INTO commercial_skus (
         sku_code, name, category_id, feature_id, edition_id, uom_id, currency_id, tax_class_id, billing_type_id,
         active_from, minimum_allowed_price
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [skuCode, skuCode, masters.category, masters.feature, masters.edition, masters.uom, masters.currency, masters.taxClass, masters.billingType, '2026-01-01', 100],
    )
    return result.rows[0].id
  }

  // --- representative test (verbatim from the plan) --------------------------

  it('rejects a BOM row where Parent SKU Code equals Component SKU Code', async () => {
    const rows = [{ parentSkuCode: 'X-1', componentSkuCode: 'X-1', mandatory: true, quantity: 1, notes: '' }]
    const preview = await validateBomRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors[0]).toMatch(/cannot be a bom component of itself/i)
  })

  // --- named remaining tests --------------------------------------------------

  it('rejects when Parent SKU Code does not resolve to an existing SKU', async () => {
    const masters = await makeSupportingMasters()
    await insertSku(masters, 'C-1')
    const rows = [{ parentSkuCode: 'NO-SUCH-SKU', componentSkuCode: 'C-1', mandatory: false, quantity: 1, notes: '' }]
    const preview = await validateBomRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors.join(' ')).toMatch(/parent sku code.*does not match any existing sku/i)
  })

  it('rejects when Component SKU Code does not resolve to an existing SKU', async () => {
    const masters = await makeSupportingMasters()
    await insertSku(masters, 'P-1')
    const rows = [{ parentSkuCode: 'P-1', componentSkuCode: 'NO-SUCH-SKU', mandatory: false, quantity: 1, notes: '' }]
    const preview = await validateBomRows(pool, rows)
    expect(preview[0].action).toBe('reject')
    expect(preview[0].errors.join(' ')).toMatch(/component sku code.*does not match any existing sku/i)
  })

  it('creates a valid parent/component BOM link', async () => {
    const masters = await makeSupportingMasters()
    const parentId = await insertSku(masters, 'P-1')
    const componentId = await insertSku(masters, 'C-1')
    const rows = [{ parentSkuCode: 'P-1', componentSkuCode: 'C-1', mandatory: true, quantity: 2, notes: 'bundled' }]

    const preview = await validateBomRows(pool, rows)
    expect(preview[0].action).toBe('create')
    expect(summarize(preview)).toMatchObject({ toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 0 })

    await commitBomRows(pool, rows, preview)
    const result = await pool.query('SELECT * FROM commercial_bom_items WHERE parent_sku_id=$1 AND component_sku_id=$2', [parentId, componentId])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ mandatory: true, quantity: 2, notes: 'bundled' })
  })

  it('a re-imported identical link is classified unchanged', async () => {
    const masters = await makeSupportingMasters()
    await insertSku(masters, 'P-1')
    await insertSku(masters, 'C-1')
    const rows = [{ parentSkuCode: 'P-1', componentSkuCode: 'C-1', mandatory: true, quantity: 2, notes: 'bundled' }]

    const firstPreview = await validateBomRows(pool, rows)
    await commitBomRows(pool, rows, firstPreview)

    const secondPreview = await validateBomRows(pool, rows)
    expect(secondPreview[0].action).toBe('unchanged')
    expect(summarize(secondPreview)).toMatchObject({ toCreate: 0, toUpdate: 0, unchanged: 1, rejected: 0 })
  })
})
