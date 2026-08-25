import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('commercial.masters router', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM edition_features')
    await pool.query('DELETE FROM commercial_masters')
  })

  async function makeVertical(overrides: Partial<{ code: string; name: string }> = {}) {
    const caller = appRouter.createCaller({})
    return caller.commercial.masters.create({
      key: 'verticals',
      input: { code: overrides.code ?? `VERT-${Math.random()}`, name: overrides.name ?? 'Government', description: '' },
    })
  }

  it('creates a top-level master with no parent', async () => {
    const vertical = await makeVertical({ code: 'GOV', name: 'Government' })
    expect(vertical.code).toBe('GOV')
    expect(vertical.active).toBe(true)
    expect(vertical.displayOrder).toBe(0)
  })

  it('rejects a duplicate code within the same master key, case-insensitively', async () => {
    await makeVertical({ code: 'GOV' })
    const caller = appRouter.createCaller({})
    await expect(caller.commercial.masters.create({
      key: 'verticals', input: { code: 'gov', name: 'Government Dup', description: '' },
    })).rejects.toThrow('already used')
  })

  it('allows the same code across two different master keys', async () => {
    await makeVertical({ code: 'STD' })
    const caller = appRouter.createCaller({})
    await expect(caller.commercial.masters.create({
      key: 'skuCategories', input: { code: 'STD', name: 'Standard', description: '' },
    })).resolves.toBeTruthy()
  })

  it('builds the Vertical -> Product -> Module -> Feature chain via parentId', async () => {
    const caller = appRouter.createCaller({})
    const vertical = await makeVertical({ code: 'GOV', name: 'Government' })
    const product = await caller.commercial.masters.create({
      key: 'products', input: { code: 'GOMS', name: 'GOMS', description: '', verticalId: vertical.id },
    })
    expect(product.verticalId).toBe(vertical.id)
    const module_ = await caller.commercial.masters.create({
      key: 'modules', input: { code: 'ACCT', name: 'Account Mapping', description: '', productId: product.id },
    })
    const feature = await caller.commercial.masters.create({
      key: 'features',
      input: { code: 'F1', name: 'Feature 1', description: '', moduleId: module_.id, status: 'new' },
    })
    expect(feature.moduleId).toBe(module_.id)
    expect(feature.status).toBe('new')

    const products = await caller.commercial.masters.list({ key: 'products' })
    expect(products.map((p: any) => p.id)).toContain(product.id)
  })

  it('rejects a product with a missing verticalId', async () => {
    const caller = appRouter.createCaller({})
    await expect(caller.commercial.masters.create({
      key: 'products', input: { code: 'GOMS', name: 'GOMS', description: '' },
    })).rejects.toThrow(/verticalId is required/i)
  })

  it('rejects a product referencing a nonexistent vertical', async () => {
    const caller = appRouter.createCaller({})
    await expect(caller.commercial.masters.create({
      key: 'products', input: { code: 'GOMS', name: 'GOMS', description: '', verticalId: '00000000-0000-0000-0000-000000000000' },
    })).rejects.toThrow(/no such verticals row/i)
  })

  it('refuses to delete a vertical that still has products under it', async () => {
    const caller = appRouter.createCaller({})
    const vertical = await makeVertical({ code: 'GOV' })
    await caller.commercial.masters.create({
      key: 'products', input: { code: 'GOMS', name: 'GOMS', description: '', verticalId: vertical.id },
    })
    await expect(caller.commercial.masters.delete({ key: 'verticals', id: vertical.id })).rejects.toThrow(/still reference it/)
  })

  it('deletes a leaf master with no children', async () => {
    const caller = appRouter.createCaller({})
    const vertical = await makeVertical({ code: 'GOV' })
    await caller.commercial.masters.delete({ key: 'verticals', id: vertical.id })
    expect(await caller.commercial.masters.get({ key: 'verticals', id: vertical.id })).toBeNull()
  })

  it('updates extra fields stored in JSONB (tax class rate)', async () => {
    const caller = appRouter.createCaller({})
    const taxClass = await caller.commercial.masters.create({
      key: 'taxClasses', input: { code: 'GST18', name: 'GST 18%', description: '', ratePct: 18 },
    })
    expect(taxClass.ratePct).toBe(18)
    const updated = await caller.commercial.masters.update({ key: 'taxClasses', id: taxClass.id, patch: { ratePct: 12 } })
    expect(updated!.ratePct).toBe(12)
  })

  it("requires a changeReason when a feature's status changes", async () => {
    const caller = appRouter.createCaller({})
    const vertical = await makeVertical({ code: 'GOV' })
    const product = await caller.commercial.masters.create({ key: 'products', input: { code: 'GOMS', name: 'GOMS', description: '', verticalId: vertical.id } })
    const module_ = await caller.commercial.masters.create({ key: 'modules', input: { code: 'ACCT', name: 'Account Mapping', description: '', productId: product.id } })
    const feature = await caller.commercial.masters.create({
      key: 'features', input: { code: 'F1', name: 'Feature 1', description: '', moduleId: module_.id, status: 'existing' },
    })
    await expect(caller.commercial.masters.update({ key: 'features', id: feature.id, patch: { status: 'modified' } }))
      .rejects.toThrow(/changeReason is required/)
    const updated = await caller.commercial.masters.update({
      key: 'features', id: feature.id, patch: { status: 'modified' }, changeReason: 'Reworked per client feedback',
    })
    expect(updated!.status).toBe('modified')
  })

  it('enforces a single base currency', async () => {
    const caller = appRouter.createCaller({})
    const usd = await caller.commercial.masters.create({
      key: 'currencies', input: { code: 'USD', name: 'US Dollar', description: '', symbol: '$', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true },
    })
    const inr = await caller.commercial.masters.create({
      key: 'currencies', input: { code: 'INR', name: 'Indian Rupee', description: '', symbol: '₹', decimalPlaces: 2, exchangeRate: 83, isBaseCurrency: false },
    })
    await caller.commercial.masters.update({ key: 'currencies', id: inr.id, patch: { isBaseCurrency: true } })
    const currencies = await caller.commercial.masters.list({ key: 'currencies' })
    const base = currencies.filter((c: any) => c.isBaseCurrency)
    expect(base).toHaveLength(1)
    expect(base[0].id).toBe(inr.id)
    expect((await caller.commercial.masters.get({ key: 'currencies', id: usd.id }))!.isBaseCurrency).toBe(false)
  })

  it('sets active without touching other fields', async () => {
    const caller = appRouter.createCaller({})
    const vertical = await makeVertical({ code: 'GOV' })
    await caller.commercial.masters.setActive({ key: 'verticals', id: vertical.id, active: false })
    expect((await caller.commercial.masters.get({ key: 'verticals', id: vertical.id }))!.active).toBe(false)
  })

  it('manages the edition <-> feature junction, fully replacing it on each set', async () => {
    const caller = appRouter.createCaller({})
    const vertical = await makeVertical({ code: 'GOV' })
    const product = await caller.commercial.masters.create({ key: 'products', input: { code: 'GOMS', name: 'GOMS', description: '', verticalId: vertical.id } })
    const module_ = await caller.commercial.masters.create({ key: 'modules', input: { code: 'ACCT', name: 'Account Mapping', description: '', productId: product.id } })
    const featureA = await caller.commercial.masters.create({ key: 'features', input: { code: 'FA', name: 'Feature A', description: '', moduleId: module_.id, status: 'existing' } })
    const featureB = await caller.commercial.masters.create({ key: 'features', input: { code: 'FB', name: 'Feature B', description: '', moduleId: module_.id, status: 'existing' } })
    const edition = await caller.commercial.masters.create({ key: 'productEditions', input: { code: 'STD', name: 'Standard', description: '' } })

    await caller.commercial.masters.setEditionFeatures({
      editionId: edition.id, rows: [{ featureId: featureA.id, mandatory: true }, { featureId: featureB.id, mandatory: false }],
    })
    let rows = await caller.commercial.masters.listEditionFeatures({ editionId: edition.id })
    expect(rows).toHaveLength(2)
    expect(rows.find((r: any) => r.featureId === featureA.id)?.mandatory).toBe(true)

    await caller.commercial.masters.setEditionFeatures({ editionId: edition.id, rows: [{ featureId: featureB.id, mandatory: true }] })
    rows = await caller.commercial.masters.listEditionFeatures({ editionId: edition.id })
    expect(rows).toHaveLength(1)
    expect(rows[0].featureId).toBe(featureB.id)
  })
})
