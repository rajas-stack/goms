import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('commercial.masters router', () => {
  beforeEach(async () => {
    // Cleared for the same cross-file-leftover reason as commercial-skus.test.ts.
    await pool.query('DELETE FROM commercial_audit_logs')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM commercial_bom_items')
    await pool.query('DELETE FROM commercial_skus')
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
    const logs = await caller.commercial.auditLogs.list({ entityType: 'feature', entityId: feature.id })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ field: 'status', oldValue: 'existing', newValue: 'modified', action: 'status_change', reason: 'Reworked per client feedback' })
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

  // 2026-08-26 backend hardening pass.

  it('gives a friendly CONFLICT (never a raw/unhandled error) when two concurrent creates race for the same code', async () => {
    // assertCodeAvailable's SELECT-based pre-check isn't atomic with the
    // INSERT — the unique index (commercial_masters_key_code_idx) is what
    // actually stops the duplicate from landing under concurrency, and this
    // proves the loser gets a translated CONFLICT, not a raw 23505.
    const results = await Promise.allSettled([
      appRouter.createCaller({}).commercial.masters.create({ key: 'verticals', input: { code: 'RACE', name: 'A', description: '' } }),
      appRouter.createCaller({}).commercial.masters.create({ key: 'verticals', input: { code: 'RACE', name: 'B', description: '' } }),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' })
    const verticals = await appRouter.createCaller({}).commercial.masters.list({ key: 'verticals' })
    expect(verticals.filter((v: any) => v.code === 'RACE')).toHaveLength(1)
  })

  it('refuses to delete a master still referenced by a SKU (unlike the self-referencing parent/child check, this is a cross-table reference)', async () => {
    const caller = appRouter.createCaller({})
    const vertical = await makeVertical({ code: 'GOV' })
    const product = await caller.commercial.masters.create({ key: 'products', input: { code: 'GOMS', name: 'GOMS', description: '', verticalId: vertical.id } })
    const module_ = await caller.commercial.masters.create({ key: 'modules', input: { code: 'ACCT', name: 'Account Mapping', description: '', productId: product.id } })
    const feature = await caller.commercial.masters.create({ key: 'features', input: { code: 'F1', name: 'Feature 1', description: '', moduleId: module_.id, status: 'new' } })
    const category = await caller.commercial.masters.create({ key: 'skuCategories', input: { code: 'STD', name: 'Standard', description: '' } })
    const uom = await caller.commercial.masters.create({ key: 'unitsOfMeasure', input: { code: 'LIC', name: 'License', description: '' } })
    const currency = await caller.commercial.masters.create({
      key: 'currencies', input: { code: 'INR', name: 'Indian Rupee', description: '', symbol: '₹', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true },
    })
    const taxClass = await caller.commercial.masters.create({ key: 'taxClasses', input: { code: 'GST18', name: 'GST 18%', description: '', ratePct: 18 } })
    const billingType = await caller.commercial.masters.create({ key: 'billingTypes', input: { code: 'OT', name: 'One-Time', description: '' } })
    const edition = await caller.commercial.masters.create({ key: 'productEditions', input: { code: 'STD', name: 'Standard', description: '' } })
    await caller.commercial.skus.create({
      name: 'License', categoryId: category.id, featureId: feature.id, uomId: uom.id, currencyId: currency.id,
      taxClassId: taxClass.id, billingTypeId: billingType.id, editionId: edition.id, activeFrom: '2026-01-01', activeTill: null,
      baseSoftwareCost: 0, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
      hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
      internalPrice: 100, floorPrice: 100, partnerPrice: 100, governmentPrice: 100,
      enterprisePrice: 100, corporatePrice: 100, listPrice: 100, minimumAllowedPrice: 50, maximumDiscountPercent: 10,
    })
    await expect(caller.commercial.masters.delete({ key: 'unitsOfMeasure', id: uom.id }))
      .rejects.toThrow(/still referenced by at least one sku/i)
  })
})
