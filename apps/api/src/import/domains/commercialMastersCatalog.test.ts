import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { validateCatalogRows, commitCatalogRows } from './commercialMastersCatalog.js'

async function clearCatalogMasters() {
  // Children first — commercial_masters.parent_id is ON DELETE RESTRICT.
  await pool.query(`DELETE FROM commercial_masters WHERE master_key='features'`)
  await pool.query(`DELETE FROM commercial_masters WHERE master_key='modules'`)
  await pool.query(`DELETE FROM commercial_masters WHERE master_key='products'`)
  await pool.query(`DELETE FROM commercial_masters WHERE master_key='verticals'`)
}

describe('commercialMastersCatalog importer', () => {
  beforeEach(async () => {
    await clearCatalogMasters()
  })

  it('resolves a Product row against a Vertical row earlier in the same upload', async () => {
    const verticals = [{ code: 'TRAF', name: 'Traffic', description: '', active: true, displayOrder: 0 }]
    const products = [{ code: 'SYNCNEX', name: 'Syncnex', description: '', active: true, displayOrder: 0, parentCode: 'TRAF' }]
    const preview = await validateCatalogRows(pool, { verticals, products, modules: [], features: [] })
    expect(preview.products[0].action).toBe('create')
  })

  it('rejects a Product row naming a Parent Code that resolves nowhere', async () => {
    const products = [{ code: 'SYNCNEX', name: 'Syncnex', description: '', active: true, displayOrder: 0, parentCode: 'GHOST' }]
    const preview = await validateCatalogRows(pool, { verticals: [], products, modules: [], features: [] })
    expect(preview.products[0].action).toBe('reject')
    expect(preview.products[0].errors[0]).toMatch(/GHOST/)
  })

  it('resolves the full Vertical -> Product -> Module -> Feature chain in one upload', async () => {
    const verticals = [{ code: 'TRAF', name: 'Traffic', description: '', active: true, displayOrder: 0 }]
    const products = [{ code: 'SYNCNEX', name: 'Syncnex', description: '', active: true, displayOrder: 0, parentCode: 'TRAF' }]
    const modules = [{ code: 'CORE', name: 'Core', description: '', active: true, displayOrder: 0, parentCode: 'SYNCNEX' }]
    const features = [{ code: 'ALERTS', name: 'Alerts', description: '', active: true, displayOrder: 0, parentCode: 'CORE' }]

    const preview = await validateCatalogRows(pool, { verticals, products, modules, features })
    expect(preview.verticals[0].action).toBe('create')
    expect(preview.products[0].action).toBe('create')
    expect(preview.modules[0].action).toBe('create')
    expect(preview.features[0].action).toBe('create')

    await commitCatalogRows(pool, { verticals, products, modules, features }, preview)

    const rows = await pool.query(
      `SELECT master_key, code, parent_id, id FROM commercial_masters WHERE master_key IN ('verticals','products','modules','features')`,
    )
    const byCode = new Map(rows.rows.map((r) => [r.code, r]))
    const vertical = byCode.get('TRAF')!
    const product = byCode.get('SYNCNEX')!
    const module_ = byCode.get('CORE')!
    const feature = byCode.get('ALERTS')!

    expect(product.parent_id).toBe(vertical.id)
    expect(module_.parent_id).toBe(product.id)
    expect(feature.parent_id).toBe(module_.id)
  })

  it('stores Feature Status in extra.status, defaulting to new when blank', async () => {
    const verticals = [{ code: 'TRAF', name: 'Traffic', description: '', active: true, displayOrder: 0 }]
    const products = [{ code: 'SYNCNEX', name: 'Syncnex', description: '', active: true, displayOrder: 0, parentCode: 'TRAF' }]
    const modules = [{ code: 'CORE', name: 'Core', description: '', active: true, displayOrder: 0, parentCode: 'SYNCNEX' }]
    const features = [
      { code: 'ALERTS', name: 'Alerts', description: '', active: true, displayOrder: 0, parentCode: 'CORE', featureStatus: '' },
      { code: 'REPORTS', name: 'Reports', description: '', active: true, displayOrder: 1, parentCode: 'CORE', featureStatus: 'existing' },
    ]

    const preview = await validateCatalogRows(pool, { verticals, products, modules, features })
    await commitCatalogRows(pool, { verticals, products, modules, features }, preview)

    const result = await pool.query(
      `SELECT code, extra FROM commercial_masters WHERE master_key='features' ORDER BY code`,
    )
    const byCode = new Map(result.rows.map((r) => [r.code, r.extra]))
    expect(byCode.get('ALERTS').status).toBe('new')
    expect(byCode.get('REPORTS').status).toBe('existing')
  })

  it("an update to a Vertical's Code does not orphan its already-existing Products", async () => {
    const verticals = [{ code: 'TRAF', name: 'Traffic', description: '', active: true, displayOrder: 0 }]
    const products = [{ code: 'SYNCNEX', name: 'Syncnex', description: '', active: true, displayOrder: 0, parentCode: 'TRAF' }]

    const firstPreview = await validateCatalogRows(pool, { verticals, products, modules: [], features: [] })
    await commitCatalogRows(pool, { verticals, products, modules: [], features: [] }, firstPreview)

    const before = await pool.query(`SELECT id, parent_id FROM commercial_masters WHERE master_key='products' AND code='SYNCNEX'`)
    const verticalBefore = await pool.query(`SELECT id FROM commercial_masters WHERE master_key='verticals' AND code='TRAF'`)
    expect(before.rows[0].parent_id).toBe(verticalBefore.rows[0].id)

    // Re-upload the Vertical with a changed Name (an 'update'), and the Product
    // unchanged — the Product's own business key (code) is what matches it,
    // not a re-resolution of its parent's identity.
    const updatedVerticals = [{ code: 'TRAF', name: 'Traffic Management', description: '', active: true, displayOrder: 0 }]
    const secondPreview = await validateCatalogRows(pool, { verticals: updatedVerticals, products, modules: [], features: [] })
    expect(secondPreview.verticals[0].action).toBe('update')
    expect(secondPreview.products[0].action).toBe('unchanged')

    await commitCatalogRows(pool, { verticals: updatedVerticals, products, modules: [], features: [] }, secondPreview)

    const after = await pool.query(`SELECT parent_id FROM commercial_masters WHERE master_key='products' AND code='SYNCNEX'`)
    expect(after.rows[0].parent_id).toBe(verticalBefore.rows[0].id)
    expect(after.rows[0].parent_id).not.toBeNull()
  })
})
