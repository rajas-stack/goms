import { describe, it, expect, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

describe('commercial.skus + commercial.bom routers', () => {
  beforeEach(async () => {
    // Cleared even though this suite doesn't create BOQs itself — a prior
    // file's leftover BOQ line item referencing a SKU (ON DELETE RESTRICT)
    // would otherwise fail this suite's own `DELETE FROM commercial_skus`,
    // the same class of cross-file bug Phase 2 hit with hierarchy_nodes.
    await pool.query('DELETE FROM commercial_audit_logs')
    await pool.query('DELETE FROM commercial_boq_line_items')
    await pool.query('DELETE FROM commercial_boqs')
    await pool.query('DELETE FROM commercial_bom_items')
    await pool.query('DELETE FROM commercial_skus')
    await pool.query('DELETE FROM edition_features')
    await pool.query('DELETE FROM commercial_masters')
  })

  async function makeHierarchy(caller: ReturnType<typeof appRouter.createCaller>, overrides: Partial<{
    verticalCode: string; productCode: string; moduleCode: string; featureCode: string; featureStatus: string
  }> = {}) {
    const vertical = await caller.commercial.masters.create({
      key: 'verticals', input: { code: overrides.verticalCode ?? 'GOV', name: 'Government', description: '' },
    })
    const product = await caller.commercial.masters.create({
      key: 'products', input: { code: overrides.productCode ?? 'GOMS', name: 'GOMS', description: '', verticalId: vertical.id },
    })
    const module_ = await caller.commercial.masters.create({
      key: 'modules', input: { code: overrides.moduleCode ?? 'ACCT', name: 'Account Mapping', description: '', productId: product.id },
    })
    const feature = await caller.commercial.masters.create({
      key: 'features',
      input: { code: overrides.featureCode ?? 'F1', name: 'Feature 1', description: '', moduleId: module_.id, status: overrides.featureStatus ?? 'new' },
    })
    return { vertical, product, module: module_, feature }
  }

  async function makeFeature(caller: ReturnType<typeof appRouter.createCaller>, moduleId: string, code: string, status = 'new') {
    return caller.commercial.masters.create({
      key: 'features', input: { code, name: `Feature ${code}`, description: '', moduleId, status },
    })
  }

  async function makeSupportingMasters(caller: ReturnType<typeof appRouter.createCaller>) {
    const category = await caller.commercial.masters.create({ key: 'skuCategories', input: { code: 'STD', name: 'Standard', description: '' } })
    const uom = await caller.commercial.masters.create({ key: 'unitsOfMeasure', input: { code: 'LIC', name: 'License', description: '' } })
    const currency = await caller.commercial.masters.create({
      key: 'currencies', input: { code: 'INR', name: 'Indian Rupee', description: '', symbol: '₹', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true },
    })
    const taxClass = await caller.commercial.masters.create({ key: 'taxClasses', input: { code: 'GST18', name: 'GST 18%', description: '', ratePct: 18 } })
    const billingType = await caller.commercial.masters.create({ key: 'billingTypes', input: { code: 'OT', name: 'One-Time', description: '' } })
    const edition = await caller.commercial.masters.create({ key: 'productEditions', input: { code: 'STD', name: 'Standard', description: '' } })
    return { category, uom, currency, taxClass, billingType, edition }
  }

  function baseSkuInput(feature: any, masters: any, overrides: Record<string, any> = {}) {
    return {
      name: 'Standard License',
      categoryId: masters.category.id,
      featureId: feature.id,
      uomId: masters.uom.id,
      currencyId: masters.currency.id,
      taxClassId: masters.taxClass.id,
      billingTypeId: masters.billingType.id,
      activeFrom: '2026-01-01',
      activeTill: null,
      baseSoftwareCost: 1000, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
      hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
      internalPrice: 5000, floorPrice: 6000, partnerPrice: 7000, governmentPrice: 8000,
      enterprisePrice: 9000, corporatePrice: 9500, listPrice: 10000,
      ...overrides,
    }
  }

  it('generates the SKU code as Vertical-Product-Module-Feature-STATUS, uppercased', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller, { verticalCode: 'gov', productCode: 'goms', moduleCode: 'acct', featureCode: 'f1', featureStatus: 'existing' })
    const masters = await makeSupportingMasters(caller)
    const sku = await caller.commercial.skus.create(baseSkuInput(feature, masters))
    expect(sku.skuCode).toBe('GOV-GOMS-ACCT-F1-EXG')
  })

  it('rejects creating a second SKU that would generate the same code', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    await caller.commercial.skus.create(baseSkuInput(feature, masters))
    await expect(caller.commercial.skus.create(baseSkuInput(feature, masters))).rejects.toThrow(/already exists/)
  })

  it('2026-08-26 hardening: gives a friendly CONFLICT (never a raw error) when two concurrent creates race for the same generated code', async () => {
    // The dupResult SELECT in skus.create isn't atomic with its INSERT —
    // commercial_skus_sku_code_idx is what actually stops the duplicate,
    // this proves the loser of the race gets a translated CONFLICT.
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    const results = await Promise.allSettled([
      appRouter.createCaller({}).commercial.skus.create(baseSkuInput(feature, masters)),
      appRouter.createCaller({}).commercial.skus.create(baseSkuInput(feature, masters)),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' })
  })

  it('defaults minimumAllowedPrice to floorPrice when omitted', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    const sku = await caller.commercial.skus.create(baseSkuInput(feature, masters, { floorPrice: 6500 }))
    expect(sku.minimumAllowedPrice).toBe(6500)
  })

  it('honors an explicit minimumAllowedPrice distinct from floorPrice', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    const sku = await caller.commercial.skus.create(baseSkuInput(feature, masters, { floorPrice: 6500, minimumAllowedPrice: 7200 }))
    expect(sku.minimumAllowedPrice).toBe(7200)
  })

  it('clamps maximumDiscountPercent to 90 even if a higher value is requested', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    const sku = await caller.commercial.skus.create(baseSkuInput(feature, masters, { maximumDiscountPercent: 95 }))
    expect(sku.maximumDiscountPercent).toBe(90)
  })

  it('defaults maximumDiscountPercent to 90 when omitted', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    const sku = await caller.commercial.skus.create(baseSkuInput(feature, masters))
    expect(sku.maximumDiscountPercent).toBe(90)
  })

  it('accepts a lower maximumDiscountPercent unchanged', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    const sku = await caller.commercial.skus.create(baseSkuInput(feature, masters, { maximumDiscountPercent: 25 }))
    expect(sku.maximumDiscountPercent).toBe(25)
  })

  it('stores selectedPricingLevels with independent per-level maximumDiscountPercent', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    const sku = await caller.commercial.skus.create(baseSkuInput(feature, masters, {
      selectedPricingLevels: [
        { level: 'internal', maximumDiscountPercent: 40 },
        { level: 'government', maximumDiscountPercent: 15 },
      ],
    }))
    expect(sku.selectedPricingLevels).toEqual([
      { level: 'internal', maximumDiscountPercent: 40 },
      { level: 'government', maximumDiscountPercent: 15 },
    ])
    // Updating one level's cap must not disturb the other's (2026-08-20 UI correction).
    const updated = await caller.commercial.skus.update({
      id: sku.id,
      patch: { selectedPricingLevels: [{ level: 'internal', maximumDiscountPercent: 60 }, { level: 'government', maximumDiscountPercent: 15 }] },
      changeReason: 'Adjust internal discount cap',
    })
    expect(updated.selectedPricingLevels).toEqual([
      { level: 'internal', maximumDiscountPercent: 60 },
      { level: 'government', maximumDiscountPercent: 15 },
    ])
  })

  it('defaults editionId to the STD product edition when omitted', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    const sku = await caller.commercial.skus.create(baseSkuInput(feature, masters))
    expect(sku.editionId).toBe(masters.edition.id)
  })

  it('rejects a SKU referencing a nonexistent tax class', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    await expect(caller.commercial.skus.create(baseSkuInput(feature, masters, { taxClassId: '00000000-0000-0000-0000-000000000000' })))
      .rejects.toThrow(/no such tax class/i)
  })

  it('requires a changeReason when changing lifecycleStatus, but not for a non-sensitive field', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    const sku = await caller.commercial.skus.create(baseSkuInput(feature, masters))

    await expect(caller.commercial.skus.update({ id: sku.id, patch: { lifecycleStatus: 'active' } }))
      .rejects.toThrow(/changeReason is required/)

    const renamed = await caller.commercial.skus.update({ id: sku.id, patch: { name: 'Renamed License' } })
    expect(renamed.name).toBe('Renamed License')

    const activated = await caller.commercial.skus.update({ id: sku.id, patch: { lifecycleStatus: 'active' }, changeReason: 'Go-live' })
    expect(activated.lifecycleStatus).toBe('active')

    const logs = await caller.commercial.auditLogs.list({ entityType: 'sku', entityId: sku.id })
    expect(logs.filter((l) => l.field === 'lifecycleStatus')).toHaveLength(1)
    expect(logs.find((l) => l.field === 'lifecycleStatus')).toMatchObject({ action: 'status_change', newValue: 'active', reason: 'Go-live' })
  })

  it('requires a changeReason when changing a cost or pricing field', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    const sku = await caller.commercial.skus.create(baseSkuInput(feature, masters))
    await expect(caller.commercial.skus.update({ id: sku.id, patch: { listPrice: 12000 } }))
      .rejects.toThrow(/changeReason is required/)
    const updated = await caller.commercial.skus.update({ id: sku.id, patch: { listPrice: 12000 }, changeReason: 'Price revision' })
    expect(updated.listPrice).toBe(12000)
  })

  it('keeps pricing levels/costs as plain numbers, not strings, round-tripped through Postgres NUMERIC', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    const sku = await caller.commercial.skus.create(baseSkuInput(feature, masters, { listPrice: 12345.67 }))
    expect(typeof sku.listPrice).toBe('number')
    expect(sku.listPrice).toBe(12345.67)
    const fetched = await caller.commercial.skus.get({ id: sku.id })
    expect(typeof fetched!.baseSoftwareCost).toBe('number')
  })

  it('rejects deleting a SKU that is still referenced by a BOM entry, allows it once the reference is gone', async () => {
    const caller = appRouter.createCaller({})
    const { feature } = await makeHierarchy(caller)
    const masters = await makeSupportingMasters(caller)
    const parent = await caller.commercial.skus.create(baseSkuInput(feature, masters))
    const feature2 = await makeFeature(caller, feature.moduleId, 'F2')
    const component = await caller.commercial.skus.create(baseSkuInput(feature2, masters, { listPrice: 1000 }))
    const bom = await caller.commercial.bom.create({ parentSkuId: parent.id, componentSkuId: component.id, mandatory: true, quantity: 1, notes: '' })

    await expect(caller.commercial.skus.delete({ id: component.id })).rejects.toThrow(/still referenced/)
    await caller.commercial.bom.delete({ id: bom.id })
    await expect(caller.commercial.skus.delete({ id: component.id })).resolves.toBeUndefined()
  })

  describe('commercial.bom', () => {
    it('rejects a SKU as its own BOM component', async () => {
      const caller = appRouter.createCaller({})
      const { feature } = await makeHierarchy(caller)
      const masters = await makeSupportingMasters(caller)
      const sku = await caller.commercial.skus.create(baseSkuInput(feature, masters))
      await expect(caller.commercial.bom.create({ parentSkuId: sku.id, componentSkuId: sku.id, mandatory: true, quantity: 1, notes: '' }))
        .rejects.toThrow(/cannot be a BOM component of itself/)
    })

    it('rejects a BOM item referencing a nonexistent component SKU', async () => {
      const caller = appRouter.createCaller({})
      const { feature } = await makeHierarchy(caller)
      const masters = await makeSupportingMasters(caller)
      const sku = await caller.commercial.skus.create(baseSkuInput(feature, masters))
      await expect(caller.commercial.bom.create({
        parentSkuId: sku.id, componentSkuId: '00000000-0000-0000-0000-000000000000', mandatory: true, quantity: 1, notes: '',
      })).rejects.toThrow(/no such component sku/i)
    })

    it('lists BOM items scoped to a parent SKU, and separately as the full aggregate', async () => {
      const caller = appRouter.createCaller({})
      const { feature } = await makeHierarchy(caller)
      const masters = await makeSupportingMasters(caller)
      const parent = await caller.commercial.skus.create(baseSkuInput(feature, masters))
      const f2 = await makeFeature(caller, feature.moduleId, 'F2')
      const component = await caller.commercial.skus.create(baseSkuInput(f2, masters, { listPrice: 500 }))
      await caller.commercial.bom.create({ parentSkuId: parent.id, componentSkuId: component.id, mandatory: true, quantity: 2, notes: 'bundled' })

      const forParent = await caller.commercial.bom.listForSku({ parentSkuId: parent.id })
      expect(forParent).toHaveLength(1)
      expect(forParent[0].mandatory).toBe(true)
      expect(forParent[0].quantity).toBe(2)

      const all = await caller.commercial.bom.listAll()
      expect(all).toHaveLength(1)
    })

    it('distinguishes mandatory from optional BOM components and preserves that flag on update', async () => {
      const caller = appRouter.createCaller({})
      const { feature } = await makeHierarchy(caller)
      const masters = await makeSupportingMasters(caller)
      const parent = await caller.commercial.skus.create(baseSkuInput(feature, masters))
      const f2 = await makeFeature(caller, feature.moduleId, 'F2')
      const component = await caller.commercial.skus.create(baseSkuInput(f2, masters, { listPrice: 500 }))
      const bom = await caller.commercial.bom.create({ parentSkuId: parent.id, componentSkuId: component.id, mandatory: false, quantity: 1, notes: '' })
      expect(bom.mandatory).toBe(false)
      const updated = await caller.commercial.bom.update({ id: bom.id, patch: { mandatory: true } })
      expect(updated.mandatory).toBe(true)
      expect(updated.quantity).toBe(1)
    })

    it('throws updating a nonexistent BOM item, but delete of a nonexistent id is a no-op', async () => {
      const caller = appRouter.createCaller({})
      await expect(caller.commercial.bom.update({ id: '00000000-0000-0000-0000-000000000000', patch: { mandatory: true } }))
        .rejects.toThrow(/no such bom item/i)
      await expect(caller.commercial.bom.delete({ id: '00000000-0000-0000-0000-000000000000' })).resolves.toBeUndefined()
    })
  })
})
