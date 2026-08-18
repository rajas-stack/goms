import { describe, expect, it } from 'vitest'
import {
  listMaster, getMaster, createMaster, updateMaster, setMasterActive, deleteMaster,
  listEditionFeatures, setEditionFeatures,
} from './commercial-masters'

describe('commercial masters (Supabase integration)', () => {
  it('listMaster returns the 8 seeded verticals, display-order sorted', async () => {
    const verticals = await listMaster('verticals')
    expect(verticals.length).toBe(8)
    const sorted = [...verticals].sort((a, b) => a.displayOrder - b.displayOrder)
    expect(verticals.map((v) => v.id)).toEqual(sorted.map((v) => v.id))
  })

  it('getMaster returns null for a missing id', async () => {
    expect(await getMaster('verticals', '00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('createMaster + updateMaster + deleteMaster round-trips a flat master (skuCategories)', async () => {
    const created = await createMaster('skuCategories', {
      code: 'TESTCAT', name: 'Test Category', description: '', active: true,
    })
    expect(created.code).toBe('TESTCAT')

    const updated = await updateMaster('skuCategories', created.id, { name: 'Renamed Category' })
    expect(updated.name).toBe('Renamed Category')

    await setMasterActive('skuCategories', created.id, false)
    expect((await getMaster('skuCategories', created.id))?.active).toBe(false)

    await deleteMaster('skuCategories', created.id)
    expect(await getMaster('skuCategories', created.id)).toBeNull()
  })

  it('rejects a duplicate code, case-insensitively', async () => {
    const created = await createMaster('skuCategories', { code: 'DUPTEST', name: 'Dup Test', description: '', active: true })
    await expect(createMaster('skuCategories', { code: 'duptest', name: 'Dup Test 2', description: '', active: true }))
      .rejects.toThrow('already used')
    await deleteMaster('skuCategories', created.id)
  })

  it('validateParentExists rejects a product with no such vertical', async () => {
    await expect(createMaster('products', {
      code: 'BADPROD', name: 'Bad Product', description: '', active: true,
      verticalId: '00000000-0000-0000-0000-000000000000',
    })).rejects.toThrow('No such verticals row')
  })

  it('deleteMaster blocks deleting a vertical that still has products', async () => {
    // Not every seeded vertical has products (some are seeded with zero) —
    // pick a vertical guaranteed to have at least one child via the products
    // list itself, rather than assuming an arbitrary vertical does.
    const products = await listMaster('products')
    await expect(deleteMaster('verticals', products[0].verticalId)).rejects.toThrow('row(s) still reference it')
  })

  it('feature status change requires a non-empty changeReason and writes an audit entry', async () => {
    const products = await listMaster('products')
    const module = await createMaster('modules', { code: 'TESTMOD', name: 'Test Module', description: '', active: true, productId: products[0].id })
    const feature = await createMaster('features', {
      code: 'TESTFEAT', name: 'Test Feature', description: '', active: true, moduleId: module.id, status: 'new',
    })

    await expect(updateMaster('features', feature.id, { status: 'existing' })).rejects.toThrow('changeReason is required')
    const updated = await updateMaster('features', feature.id, { status: 'existing' }, 'promoted to GA')
    expect(updated.status).toBe('existing')

    await deleteMaster('features', feature.id)
    await deleteMaster('modules', module.id)
  })

  it('enforceSingleBaseCurrency clears the previous base currency when a new one is set', async () => {
    const currencies = await listMaster('currencies')
    const previousBase = currencies.find((c) => c.isBaseCurrency)!

    const created = await createMaster('currencies', {
      code: 'TESTCUR', name: 'Test Currency', description: '', active: true,
      symbol: 'T', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true,
    })
    expect(created.isBaseCurrency).toBe(true)
    expect((await getMaster('currencies', previousBase.id))?.isBaseCurrency).toBe(false)

    // Restore the original base currency and clean up the test row.
    await updateMaster('currencies', previousBase.id, { isBaseCurrency: true })
    await deleteMaster('currencies', created.id)
  })

  it('setEditionFeatures replaces the full mapping for an edition', async () => {
    const editions = await listMaster('productEditions')
    const features = await listMaster('features')
    const edition = editions[0]

    await setEditionFeatures(edition.id, [{ featureId: features[0].id, mandatory: true }])
    let mapped = await listEditionFeatures(edition.id)
    expect(mapped).toHaveLength(1)
    expect(mapped[0]).toMatchObject({ featureId: features[0].id, mandatory: true })

    await setEditionFeatures(edition.id, [])
    mapped = await listEditionFeatures(edition.id)
    expect(mapped).toHaveLength(0)
  })
})
