import { describe, expect, it } from 'vitest'
import { createMaster, deleteMaster, listMaster } from './commercial-masters'
import { createSku, deleteSku } from './commercial-skus'
import { createBomItem, deleteBomItem, listAllBomItems, listBomItemsForSku, updateBomItem } from './commercial-bom'

async function buildTwoSkus() {
  const vertical = await createMaster('verticals', { code: 'BOMTEST', name: 'BOM Test Vertical', description: '', active: true })
  const product = await createMaster('products', { code: 'BOMTEST', name: 'BOM Test Product', description: '', active: true, verticalId: vertical.id })
  const module = await createMaster('modules', { code: 'BOMTEST', name: 'BOM Test Module', description: '', active: true, productId: product.id })
  const feature = await createMaster('features', { code: 'BOMTEST', name: 'BOM Test Feature', description: '', active: true, moduleId: module.id, status: 'new' })
  // generateSkuCode is a pure function of featureId (+ status) — parent and
  // component need distinct features, or they'd both generate the identical
  // skuCode and the second createSku would reject as a duplicate.
  const feature2 = await createMaster('features', { code: 'BOMTEST2', name: 'BOM Test Feature 2', description: '', active: true, moduleId: module.id, status: 'new' })
  const category = await createMaster('skuCategories', { code: 'BOMTEST', name: 'BOM Test Category', description: '', active: true })
  const uom = await createMaster('unitsOfMeasure', { code: 'BOMTEST', name: 'BOM Test UOM', description: '', active: true })
  const [currency] = await listMaster('currencies')
  const [taxClass] = await listMaster('taxClasses')
  const [billingType] = await listMaster('billingTypes')

  const baseInput = {
    categoryId: category.id, featureId: feature.id, uomId: uom.id, currencyId: currency.id,
    taxClassId: taxClass.id, billingTypeId: billingType.id, activeFrom: '2026-01-01', activeTill: null,
    baseSoftwareCost: 100, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
    hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
    internalPrice: 150, floorPrice: 100, partnerPrice: 160, governmentPrice: 140,
    enterprisePrice: 170, corporatePrice: 170, listPrice: 180,
  }
  const parent = await createSku({ ...baseInput, name: 'Parent SKU' })
  const component = await createSku({ ...baseInput, name: 'Component SKU', featureId: feature2.id })

  return {
    parent, component,
    async cleanup() {
      await deleteSku(parent.id)
      await deleteSku(component.id)
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

describe('commercial BOM (Supabase integration)', () => {
  it('createBomItem + listBomItemsForSku round-trips a component', async () => {
    const { parent, component, cleanup } = await buildTwoSkus()
    const bomItem = await createBomItem({ parentSkuId: parent.id, componentSkuId: component.id, mandatory: true, quantity: 2, notes: 'test note' })

    const items = await listBomItemsForSku(parent.id)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ componentSkuId: component.id, mandatory: true, quantity: 2, notes: 'test note' })

    await deleteBomItem(bomItem.id)
    await cleanup()
  })

  it('rejects a SKU being its own BOM component', async () => {
    const { parent, cleanup } = await buildTwoSkus()
    await expect(createBomItem({ parentSkuId: parent.id, componentSkuId: parent.id, mandatory: false, quantity: 1, notes: '' }))
      .rejects.toThrow('cannot be a BOM component of itself')
    await cleanup()
  })

  it('updateBomItem changes mandatory/quantity, throws on a missing id', async () => {
    const { parent, component, cleanup } = await buildTwoSkus()
    const bomItem = await createBomItem({ parentSkuId: parent.id, componentSkuId: component.id, mandatory: false, quantity: 1, notes: '' })

    const updated = await updateBomItem(bomItem.id, { mandatory: true, quantity: 5 })
    expect(updated.mandatory).toBe(true)
    expect(updated.quantity).toBe(5)

    await expect(updateBomItem('00000000-0000-0000-0000-000000000000', { quantity: 1 })).rejects.toThrow('No such BOM item')

    await deleteBomItem(bomItem.id)
    await cleanup()
  })

  it('listAllBomItems includes items across different parent SKUs', async () => {
    const { parent, component, cleanup } = await buildTwoSkus()
    const bomItem = await createBomItem({ parentSkuId: parent.id, componentSkuId: component.id, mandatory: false, quantity: 1, notes: '' })

    const all = await listAllBomItems()
    expect(all.some((b) => b.id === bomItem.id)).toBe(true)

    await deleteBomItem(bomItem.id)
    await cleanup()
  })
})
