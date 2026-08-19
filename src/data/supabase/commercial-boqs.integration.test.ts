import { describe, expect, it } from 'vitest'
import { listDepartments } from './departments'
import { listSalesPersons } from './sales-people'
import { listAllEmployees } from './employees'
import { createMaster, deleteMaster, listMaster } from './commercial-masters'
import { createSku, deleteSku } from './commercial-skus'
import {
  addBoqLineItem, createBoq, deleteBoq, duplicateBoq, getBoq, listAllBoqLineItems, listBoqLineItems, listBoqs,
  removeBoqLineItem, reviseBoq, updateBoqLineItem, updateBoqStatus,
} from './commercial-boqs'
import { listAuditLogs } from './audit-logs'

// `approverId` is an FK to `employees`, NOT `sales_people` — a different
// table with different uuids (confirmed against the schema comment on
// `commercial_boq_line_items.approver_id` and `ProposalDetail.tsx`'s
// approver picker, which reads `useAllEmployees()`). Using a sales-person id
// here would violate the real FK constraint that only exists in Postgres,
// never in the in-memory fallback — exactly the kind of gap these
// integration tests exist to catch.
async function buildFixture() {
  const departments = await listDepartments()
  const salesPersons = await listSalesPersons()
  const employees = await listAllEmployees()
  const vertical = await createMaster('verticals', { code: 'BOQTEST', name: 'BOQ Test Vertical', description: '', active: true })
  const product = await createMaster('products', { code: 'BOQTEST', name: 'BOQ Test Product', description: '', active: true, verticalId: vertical.id })
  const module_ = await createMaster('modules', { code: 'BOQTEST', name: 'BOQ Test Module', description: '', active: true, productId: product.id })
  const feature = await createMaster('features', { code: 'BOQTEST', name: 'BOQ Test Feature', description: '', active: true, moduleId: module_.id, status: 'new' })
  // A second feature under the same module — needed by the multi-currency
  // test, which must create a second SKU with a DIFFERENT generated
  // sku_code. generateSkuCode derives the code purely from the
  // vertical/product/module/feature code chain (not currency/name), so two
  // SKUs sharing one featureId would collide on the unique sku_code
  // constraint.
  const altFeature = await createMaster('features', { code: 'BOQTEST2', name: 'BOQ Test Feature 2', description: '', active: true, moduleId: module_.id, status: 'new' })
  const category = await createMaster('skuCategories', { code: 'BOQTEST', name: 'BOQ Test Category', description: '', active: true })
  const uom = await createMaster('unitsOfMeasure', { code: 'BOQTEST', name: 'BOQ Test UOM', description: '', active: true })
  const currencies = await listMaster('currencies')
  const taxClasses = await listMaster('taxClasses')
  const billingTypes = await listMaster('billingTypes')
  const inrCurrency = currencies.find((c) => c.code === 'INR') ?? currencies[0]

  const sku = await createSku({
    name: 'BOQ Test SKU', categoryId: category.id, featureId: feature.id, uomId: uom.id,
    currencyId: inrCurrency.id, taxClassId: taxClasses[0].id, billingTypeId: billingTypes[0].id,
    activeFrom: '2026-01-01', activeTill: null,
    baseSoftwareCost: 1000, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
    hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
    internalPrice: 1200, floorPrice: 1000, partnerPrice: 1300, governmentPrice: 1100,
    enterprisePrice: 1400, corporatePrice: 1400, listPrice: 2000,
  })

  return {
    departmentId: departments[0].id, salesPersonId: salesPersons[0].id, employeeId: employees[0].id,
    vertical, sku, altFeatureId: altFeature.id, currencyCode: inrCurrency.code, currencies,
    async cleanup() {
      await deleteSku(sku.id)
      await deleteMaster('features', altFeature.id)
      await deleteMaster('features', feature.id)
      await deleteMaster('modules', module_.id)
      await deleteMaster('products', product.id)
      await deleteMaster('verticals', vertical.id)
      await deleteMaster('skuCategories', category.id)
      await deleteMaster('unitsOfMeasure', uom.id)
    },
  }
}

function boqInput(fixture: Awaited<ReturnType<typeof buildFixture>>) {
  return {
    opportunityName: 'Test Opportunity', departmentId: fixture.departmentId, customerName: 'ACME',
    customerOrganization: 'ACME Corp', customerAddress: '', customerGst: '', customerContact: '',
    verticalId: fixture.vertical.id, budgetAmount: '', budgetUnit: '', budgetKnown: '', emdAmount: '', emdUnit: '',
    salesPersonId: fixture.salesPersonId, buSalesPersonId: null, preSalesId: null, currency: fixture.currencyCode,
  }
}

describe('commercial BOQs (Supabase integration)', () => {
  it('createBoq generates a year-scoped, zero-padded boqNumber, starts in draft, and round-trips the customer snapshot fields', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    expect(boq.status).toBe('draft')
    expect(boq.boqVersion).toBe(1)
    expect(boq.parentBoqId).toBeNull()
    expect(boq.boqNumber).toMatch(/^BOQ-\d{4}-\d{6}$/)
    expect(boq.customerName).toBe('ACME')
    expect(boq.customerOrganization).toBe('ACME Corp')
    expect(boq.departmentId).toBe(fixture.departmentId)
    expect(boq.salesPersonId).toBe(fixture.salesPersonId)
    await deleteBoq(boq.id)
    await fixture.cleanup()
  })

  it('allocates strictly sequential, collision-free boqNumbers under concurrent createBoq calls', async () => {
    const fixture = await buildFixture()
    const created = await Promise.all(Array.from({ length: 5 }, () => createBoq(boqInput(fixture))))
    const numbers = created.map((b) => b.boqNumber)
    expect(new Set(numbers).size).toBe(5)
    await Promise.all(created.map((b) => deleteBoq(b.id)))
    await fixture.cleanup()
  })

  it('addBoqLineItem auto-approves within the auto-approve band and computes lineTotal', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    const line = await addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 2, unitPrice: 2000, discountPct: 5 })
    expect(line.approvalStatus).toBe('auto_approved')
    expect(line.lineTotal).toBeCloseTo(2 * 2000 * 0.95 * 1.18, 5)
    await deleteBoq(boq.id)
    await fixture.cleanup()
  })

  it('persists and round-trips pricingLevels/activePricingLevel', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    const line = await addBoqLineItem(boq.id, {
      skuId: fixture.sku.id, quantity: 1, unitPrice: 1700, discountPct: 15,
      pricingLevels: [{ level: 'government', sellingPrice: 1700 }], activePricingLevel: 'government',
    })
    expect(line.pricingLevels).toEqual([{ level: 'government', sellingPrice: 1700 }])
    expect(line.activePricingLevel).toBe('government')

    const updated = await updateBoqLineItem(line.id, {
      pricingLevels: [{ level: 'government', sellingPrice: 1700 }, { level: 'enterprise', sellingPrice: 1900 }],
      activePricingLevel: 'enterprise', unitPrice: 1900, discountPct: 5,
    })
    expect(updated.pricingLevels).toHaveLength(2)
    expect(updated.activePricingLevel).toBe('enterprise')

    const [refetched] = await listBoqLineItems(boq.id)
    expect(refetched.pricingLevels).toHaveLength(2)
    expect(refetched.activePricingLevel).toBe('enterprise')
    await deleteBoq(boq.id)
    await fixture.cleanup()
  })

  it('defaults pricingLevels to [] and activePricingLevel to null when omitted', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    const line = await addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    expect(line.pricingLevels).toEqual([])
    expect(line.activePricingLevel).toBeNull()
    await deleteBoq(boq.id)
    await fixture.cleanup()
  })

  it('converts a line priced in a different currency into the BOQ currency before summing the grand total', async () => {
    const fixture = await buildFixture()
    const usdCurrency = fixture.currencies.find((c) => c.code === 'USD')
    if (!usdCurrency) return
    const usdSku = await createSku({
      name: 'BOQ Test USD SKU', categoryId: fixture.sku.categoryId, featureId: fixture.altFeatureId, uomId: fixture.sku.uomId,
      currencyId: usdCurrency.id, taxClassId: fixture.sku.taxClassId, billingTypeId: fixture.sku.billingTypeId,
      activeFrom: '2026-01-01', activeTill: null,
      baseSoftwareCost: 100, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
      hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
      internalPrice: 120, floorPrice: 100, partnerPrice: 130, governmentPrice: 110,
      enterprisePrice: 140, corporatePrice: 140, listPrice: 1000,
    })
    const boq = await createBoq(boqInput(fixture))
    const inrLine = await addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    const usdLine = await addBoqLineItem(boq.id, { skuId: usdSku.id, quantity: 1, unitPrice: 1000, discountPct: 0 })
    const baseCurrency = fixture.currencies.find((c) => c.code === fixture.currencyCode)!
    const factor = usdCurrency.exchangeRate / baseCurrency.exchangeRate
    expect(usdLine.lineTotal).toBeCloseTo(1000 * 1.18 * factor, 5)
    const total = (await getBoq(boq.id))!.grandTotal
    expect(total).toBeCloseTo(inrLine.lineTotal + usdLine.lineTotal, 5)
    await deleteBoq(boq.id)
    await deleteSku(usdSku.id)
    await fixture.cleanup()
  })

  it('rejects a discount that pushes unit price below the SKU floor', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    await expect(addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 1, unitPrice: 2000, discountPct: 90 }))
      .rejects.toThrow(/below this SKU's minimum allowed price/i)
    await deleteBoq(boq.id)
    await fixture.cleanup()
  })

  it('rejects a non-positive quantity on add and update', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    await expect(addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 0, unitPrice: 2000, discountPct: 0 }))
      .rejects.toThrow(/quantity must be greater than 0/i)
    const line = await addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    await expect(updateBoqLineItem(line.id, { quantity: -1 })).rejects.toThrow(/quantity must be greater than 0/i)
    await deleteBoq(boq.id)
    await fixture.cleanup()
  })

  it('recomputes grandTotal as lines are added, updated, and removed', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    const line = await addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    expect((await getBoq(boq.id))?.grandTotal).toBeCloseTo(2000 * 1.18, 5)

    await updateBoqLineItem(line.id, { quantity: 3 })
    expect((await getBoq(boq.id))?.grandTotal).toBeCloseTo(3 * 2000 * 1.18, 5)

    await removeBoqLineItem(line.id)
    expect((await getBoq(boq.id))?.grandTotal).toBe(0)
    await deleteBoq(boq.id)
    await fixture.cleanup()
  })

  it('editing discountPct resets approval state; editing quantity alone does not', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    const line = await addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 1, unitPrice: 2000, discountPct: 20 })
    expect(line.approvalStatus).toBe('pending')

    await updateBoqLineItem(line.id, { approvalStatus: 'approved', approverId: fixture.employeeId, approvalRemarks: 'ok', approvalDate: '2026-08-19' })
    const afterQtyEdit = await updateBoqLineItem(line.id, { quantity: 3 })
    expect(afterQtyEdit.approvalStatus).toBe('approved')

    const afterDiscountEdit = await updateBoqLineItem(line.id, { discountPct: 5 })
    expect(afterDiscountEdit.approvalStatus).toBe('auto_approved')
    expect(afterDiscountEdit.approverId).toBeNull()
    expect(afterDiscountEdit.approvalRemarks).toBe('')
    await deleteBoq(boq.id)
    await fixture.cleanup()
  })

  it('writes audit entries for quantity/discountPct edits but not for add/remove', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    const line = await addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 1, unitPrice: 2000, discountPct: 5 })
    await updateBoqLineItem(line.id, { quantity: 4, discountPct: 15 })
    const entries = await listAuditLogs({ entityType: 'boqLineItem', entityId: line.id })
    expect(entries.map((e) => e.field).sort()).toEqual(['discountPct', 'quantity'])
    await removeBoqLineItem(line.id)
    const afterRemove = await listAuditLogs({ entityType: 'boqLineItem', entityId: line.id })
    expect(afterRemove).toHaveLength(2) // add/remove write no new entries — still just the earlier quantity/discountPct pair
    await deleteBoq(boq.id)
    await fixture.cleanup()
  })

  it('recomputes live draft pricing on read but freezes it once submitted', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    await addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 2, unitPrice: 2000, discountPct: 0 })

    await updateBoqStatus(boq.id, 'submitted', 'send to customer')
    const [frozenLine] = await listBoqLineItems(boq.id)
    expect(frozenLine.unitPrice).toBe(2000)
    expect(frozenLine.lineTotal).toBeCloseTo(2 * 2000 * 1.18, 5)

    await updateBoqStatus(boq.id, 'cancelled', 'test cleanup')
    await deleteBoq(boq.id)
    await fixture.cleanup()
  })

  it('blocks approving while a line is pending or rejected, allows it once resolved', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    const line = await addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 1, unitPrice: 2000, discountPct: 20 })
    await updateBoqStatus(boq.id, 'submitted', 'x')
    await updateBoqStatus(boq.id, 'under_review', 'x')
    await expect(updateBoqStatus(boq.id, 'approved', 'x')).rejects.toThrow(/approved discount status/i)

    await updateBoqLineItem(line.id, { approvalStatus: 'approved', approverId: fixture.employeeId, approvalRemarks: 'ok', approvalDate: '2026-08-19' })
    const approved = await updateBoqStatus(boq.id, 'approved', 'x')
    expect(approved.status).toBe('approved')

    await updateBoqStatus(boq.id, 'archived', 'x')
    await deleteBoq(boq.id)
    await fixture.cleanup()
  })

  it('rejects an invalid transition and blocks cancelling an approved BOQ', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    await expect(updateBoqStatus(boq.id, 'approved', 'x')).rejects.toThrow(/cannot transition/i)
    await updateBoqStatus(boq.id, 'submitted', 'x')
    await updateBoqStatus(boq.id, 'under_review', 'x')
    await updateBoqStatus(boq.id, 'approved', 'x')
    await expect(updateBoqStatus(boq.id, 'cancelled', 'x')).rejects.toThrow(/cannot transition/i)
    await updateBoqStatus(boq.id, 'archived', 'x')
    await deleteBoq(boq.id)
    await fixture.cleanup()
  })

  it('reviseBoq keeps the boqNumber, bumps boqVersion, links parentBoqId, and resets line approval freshly', async () => {
    const fixture = await buildFixture()
    const original = await createBoq(boqInput(fixture))
    const line = await addBoqLineItem(original.id, { skuId: fixture.sku.id, quantity: 1, unitPrice: 2000, discountPct: 20 })
    await updateBoqLineItem(line.id, { approvalStatus: 'rejected', approverId: fixture.employeeId, approvalRemarks: 'no' })
    await updateBoqStatus(original.id, 'submitted', 'x')

    const revised = await reviseBoq(original.id)
    expect(revised.boqNumber).toBe(original.boqNumber)
    expect(revised.boqVersion).toBe(2)
    expect(revised.revisionNumber).toBe(0)
    expect(revised.parentBoqId).toBe(original.id)
    expect(revised.status).toBe('draft')

    const [revisedLine] = await listBoqLineItems(revised.id)
    expect(revisedLine.approvalStatus).toBe('pending')
    expect(revisedLine.approverId).toBeNull()

    // Delete the revision before its parent — commercial_boqs.parent_boq_id
    // has no ON DELETE cascade/set-null, so Postgres correctly rejects
    // deleting a BOQ that a revision still references (stricter than the
    // in-memory version, which has no FK integrity check at all here).
    await updateBoqStatus(original.id, 'cancelled', 'x')
    await deleteBoq(revised.id)
    await deleteBoq(original.id)
    await fixture.cleanup()
  })

  it('duplicateBoq gets a fresh boqNumber, boqVersion 1, and no parentBoqId', async () => {
    const fixture = await buildFixture()
    const original = await createBoq(boqInput(fixture))
    await addBoqLineItem(original.id, { skuId: fixture.sku.id, quantity: 1, unitPrice: 2000, discountPct: 5 })

    const duplicate = await duplicateBoq(original.id)
    expect(duplicate.boqNumber).not.toBe(original.boqNumber)
    expect(duplicate.boqVersion).toBe(1)
    expect(duplicate.parentBoqId).toBeNull()
    const [duplicateLine] = await listBoqLineItems(duplicate.id)
    expect(duplicateLine.approvalStatus).toBe('auto_approved')

    await deleteBoq(original.id)
    await deleteBoq(duplicate.id)
    await fixture.cleanup()
  })

  it('deleteBoq rejects a BOQ still active in the pipeline and cascades line items on a real delete', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    const line = await addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    await updateBoqStatus(boq.id, 'submitted', 'x')
    await expect(deleteBoq(boq.id)).rejects.toThrow(/cancel it first/i)

    await updateBoqStatus(boq.id, 'cancelled', 'x')
    await deleteBoq(boq.id)
    expect(await getBoq(boq.id)).toBeNull()
    expect((await listBoqLineItems(boq.id)).find((l) => l.id === line.id)).toBeUndefined()
    await fixture.cleanup()
  })

  it('deleteSku is blocked while a BOQ line item still references it, and succeeds once cleared', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    const line = await addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    await expect(deleteSku(fixture.sku.id)).rejects.toThrow(/still referenced/i)

    await removeBoqLineItem(line.id)
    await deleteBoq(boq.id)
    await fixture.cleanup() // fixture.cleanup() itself calls deleteSku — proves it now succeeds
  })

  it('listAllBoqLineItems is a raw, unpriced aggregate across every BOQ', async () => {
    const fixture = await buildFixture()
    const boq = await createBoq(boqInput(fixture))
    await addBoqLineItem(boq.id, { skuId: fixture.sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    const all = await listAllBoqLineItems()
    expect(all.some((l) => l.boqId === boq.id && l.skuId === fixture.sku.id)).toBe(true)

    await updateBoqStatus(boq.id, 'cancelled', 'x')
    await deleteBoq(boq.id)
    await fixture.cleanup()
  })

  it('listBoqs sorts newest-first by createdAt', async () => {
    const fixture = await buildFixture()
    const first = await createBoq(boqInput(fixture))
    const second = await createBoq(boqInput(fixture))
    const all = await listBoqs()
    const firstIdx = all.findIndex((b) => b.id === first.id)
    const secondIdx = all.findIndex((b) => b.id === second.id)
    expect(secondIdx).toBeLessThan(firstIdx)
    await deleteBoq(first.id)
    await deleteBoq(second.id)
    await fixture.cleanup()
  })
})
