import { describe, expect, it } from 'vitest'
import { createMaster, deleteMaster, listMaster } from './commercial-masters'
import { createSku, deleteSku, getSku, listSkus, updateSku } from './commercial-skus'
import { createBomItem, deleteBomItem } from './commercial-bom'

async function buildFeatureFixture() {
  const vertical = await createMaster('verticals', { code: 'SKUTEST', name: 'SKU Test Vertical', description: '', active: true })
  const product = await createMaster('products', { code: 'SKUTEST', name: 'SKU Test Product', description: '', active: true, verticalId: vertical.id })
  const module = await createMaster('modules', { code: 'SKUTEST', name: 'SKU Test Module', description: '', active: true, productId: product.id })
  const feature = await createMaster('features', { code: 'SKUTEST', name: 'SKU Test Feature', description: '', active: true, moduleId: module.id, status: 'new' })
  // A second, distinct feature — generateSkuCode is a pure function of
  // featureId (+ status), so two SKUs built from the SAME feature would
  // always collide on the same generated skuCode. Tests needing a "parent"
  // and a "component" SKU must use two different features.
  const feature2 = await createMaster('features', { code: 'SKUTEST2', name: 'SKU Test Feature 2', description: '', active: true, moduleId: module.id, status: 'new' })
  const category = await createMaster('skuCategories', { code: 'SKUTEST', name: 'SKU Test Category', description: '', active: true })
  const uom = await createMaster('unitsOfMeasure', { code: 'SKUTEST', name: 'SKU Test UOM', description: '', active: true })
  const currencies = await listMaster('currencies')
  const taxClasses = await listMaster('taxClasses')
  const billingTypes = await listMaster('billingTypes')
  return {
    vertical, product, module, feature, feature2, category, uom,
    currency: currencies[0], taxClass: taxClasses[0], billingType: billingTypes[0],
    async cleanup() {
      await deleteMaster('features', feature.id)
      await deleteMaster('features', feature2.id)
      await deleteMaster('modules', module.id)
      await deleteMaster('products', product.id)
      await deleteMaster('verticals', vertical.id)
      await deleteMaster('skuCategories', category.id)
      await deleteMaster('unitsOfMeasure', uom.id)
    },
  }
}

function baseSkuInput(fixture: Awaited<ReturnType<typeof buildFeatureFixture>>) {
  return {
    name: 'Test SKU', categoryId: fixture.category.id, featureId: fixture.feature.id,
    uomId: fixture.uom.id, currencyId: fixture.currency.id, taxClassId: fixture.taxClass.id,
    billingTypeId: fixture.billingType.id, activeFrom: '2026-01-01', activeTill: null,
    baseSoftwareCost: 1000, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
    hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
    internalPrice: 1200, floorPrice: 1000, partnerPrice: 1300, governmentPrice: 1100,
    enterprisePrice: 1400, corporatePrice: 1400, listPrice: 1500,
  }
}

describe('commercial SKUs (Supabase integration)', () => {
  it('createSku generates the PCS-012 code and defaults minimumAllowedPrice/maximumDiscountPercent', async () => {
    const fixture = await buildFeatureFixture()
    const sku = await createSku(baseSkuInput(fixture))
    expect(sku.skuCode).toBe('SKUTEST-SKUTEST-SKUTEST-SKUTEST-NEW')
    expect(sku.minimumAllowedPrice).toBe(1000) // defaults to floorPrice
    expect(sku.maximumDiscountPercent).toBe(90) // defaults, clamped to 90
    await deleteSku(sku.id)
    await fixture.cleanup()
  })

  it('rejects a duplicate skuCode', async () => {
    const fixture = await buildFeatureFixture()
    const sku = await createSku(baseSkuInput(fixture))
    await expect(createSku(baseSkuInput(fixture))).rejects.toThrow('already exists')
    await deleteSku(sku.id)
    await fixture.cleanup()
  })

  it('updateSku requires changeReason for cost/price/status changes and writes an audit entry', async () => {
    const fixture = await buildFeatureFixture()
    const sku = await createSku(baseSkuInput(fixture))

    await expect(updateSku(sku.id, { listPrice: 1600 })).rejects.toThrow('changeReason is required')
    const updated = await updateSku(sku.id, { listPrice: 1600 }, 'price correction')
    expect(updated.listPrice).toBe(1600)

    // Non-sensitive field (name) never requires a reason.
    const renamed = await updateSku(sku.id, { name: 'Renamed SKU' })
    expect(renamed.name).toBe('Renamed SKU')

    await deleteSku(sku.id)
    await fixture.cleanup()
  })

  it('deleteSku is blocked while a BOM item references it as a component', async () => {
    const fixture = await buildFeatureFixture()
    const parent = await createSku(baseSkuInput(fixture))
    const component = await createSku({ ...baseSkuInput(fixture), name: 'Component SKU', featureId: fixture.feature2.id })

    const bomItem = await createBomItem({
      parentSkuId: parent.id, componentSkuId: component.id, mandatory: true, quantity: 1, notes: '',
    })

    await expect(deleteSku(component.id)).rejects.toThrow('still referenced')

    await deleteBomItem(bomItem.id)
    await deleteSku(parent.id)
    await deleteSku(component.id)
    await fixture.cleanup()
  })

  it('listSkus/getSku round-trip against the seeded catalog', async () => {
    const skus = await listSkus()
    expect(skus.length).toBeGreaterThanOrEqual(6) // 6 seeded in Phase 1
    const found = await getSku(skus[0].id)
    expect(found?.skuCode).toBe(skus[0].skuCode)
  })
})
