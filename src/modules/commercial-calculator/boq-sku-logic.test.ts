import { beforeEach, describe, expect, it } from 'vitest'
import { buildDefaultCommercialCalculatorData } from './seed-defaults'
import { createMasterLogic } from './repository-logic'
import {
  addBoqLineItemLogic, computeBoqMarginPercent, computeSkuMarginPercent, createBoqLogic, createSkuLogic,
  deleteBoqLogic, deleteSkuLogic, duplicateBoqLogic, generateBoqNumber, generateSkuCode, getBoqLogic, isBoqPendingApproval,
  listBoqLineItemsLogic, listBoqsLogic, removeBoqLineItemLogic, reviseBoqLogic, skuTotalUnitCost, skuTotalUnitCostWithBom,
  updateBoqLineItemLogic, updateBoqStatusLogic, updateSkuLogic,
} from './repository-logic'
import type { CommercialCalculatorData, CommercialSku, CreateBoqInput, CreateSkuInput } from './types'

function seedHierarchy(data: CommercialCalculatorData) {
  const vertical = createMasterLogic(data, 'verticals', { code: 'GOV', name: 'Government', description: '' })
  const product = createMasterLogic(data, 'products', { code: 'GOMS', name: 'GOMS', description: '', verticalId: vertical.id })
  const module_ = createMasterLogic(data, 'modules', { code: 'AM', name: 'Account Mapping', description: '', productId: product.id })
  const feature = createMasterLogic(data, 'features', { code: 'HIER', name: 'Hierarchy Tree', description: '', moduleId: module_.id, status: 'new' })
  return { vertical, product, module_, feature }
}

function baseSkuInput(featureId: string): CreateSkuInput {
  return {
    name: 'Hierarchy Tree Feature',
    categoryId: 'skc_feature',
    featureId,
    uomId: 'uom_license',
    currencyId: 'cur_inr',
    taxClassId: 'tax_gst18',
    billingTypeId: 'bil_one_time',
    activeFrom: '2026-01-01',
    activeTill: null,
    baseSoftwareCost: 1000, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0,
    hardwareCost: 0, cloudCost: 0, supportCost: 0, trainingCost: 0,
    internalPrice: 1500, floorPrice: 1400, partnerPrice: 1600, governmentPrice: 1700,
    enterprisePrice: 1800, corporatePrice: 1900, listPrice: 2000,
  }
}

describe('generateSkuCode / createSkuLogic', () => {
  let data: CommercialCalculatorData
  beforeEach(() => { data = buildDefaultCommercialCalculatorData() })

  it('generates an uppercased, hyphenated code from the hierarchy', () => {
    const { feature } = seedHierarchy(data)
    expect(generateSkuCode(data, feature.id)).toBe('GOV-GOMS-AM-HIER-NEW')
  })

  it('creates a SKU with the generated code and defaults', () => {
    const { feature } = seedHierarchy(data)
    const sku = createSkuLogic(data, baseSkuInput(feature.id))
    expect(sku.skuCode).toBe('GOV-GOMS-AM-HIER-NEW')
    expect(sku.editionId).toBe('ped_standard')
    expect(sku.isSellable).toBe(true)
    expect(sku.lifecycleStatus).toBe('draft')
    expect(sku.minimumAllowedPrice).toBe(sku.floorPrice)
    expect(sku.maximumDiscountPercent).toBe(90)
  })

  it('rejects a duplicate SKU code', () => {
    const { feature } = seedHierarchy(data)
    createSkuLogic(data, baseSkuInput(feature.id))
    expect(() => createSkuLogic(data, baseSkuInput(feature.id))).toThrow(/already exists/i)
  })

  it('clamps maximumDiscountPercent to the 90% ceiling', () => {
    const { feature } = seedHierarchy(data)
    const sku = createSkuLogic(data, { ...baseSkuInput(feature.id), maximumDiscountPercent: 95 })
    expect(sku.maximumDiscountPercent).toBe(90)
  })
})

describe('computeSkuMarginPercent', () => {
  it('computes (listPrice - totalCost) / listPrice * 100', () => {
    const sku = { ...baseSkuInput('f'), listPrice: 2000, baseSoftwareCost: 1000 } as CommercialSku
    expect(computeSkuMarginPercent(sku)).toBe(50)
  })

  it('returns 0 for a zero list price rather than dividing by zero', () => {
    const sku = { ...baseSkuInput('f'), listPrice: 0 } as CommercialSku
    expect(computeSkuMarginPercent(sku)).toBe(0)
  })
})

describe('skuTotalUnitCostWithBom / computeSkuMarginPercent — BOM cost rollup (Option B)', () => {
  let data: CommercialCalculatorData
  let parent: CommercialSku

  beforeEach(() => {
    data = buildDefaultCommercialCalculatorData()
    const { feature, module_ } = seedHierarchy(data)
    parent = createSkuLogic(data, baseSkuInput(feature.id)) // cost 1000, listPrice 2000
    const componentFeature = createMasterLogic(data, 'features', { code: 'COMP', name: 'Component', description: '', moduleId: module_.id, status: 'new' })
    const optionalFeature = createMasterLogic(data, 'features', { code: 'OPT', name: 'Optional', description: '', moduleId: module_.id, status: 'new' })
    const mandatoryComponent = createSkuLogic(data, { ...baseSkuInput(componentFeature.id), name: 'Mandatory Component', baseSoftwareCost: 200 })
    const optionalComponent = createSkuLogic(data, { ...baseSkuInput(optionalFeature.id), name: 'Optional Component', baseSoftwareCost: 300 })
    data.commercialBomItems.push(
      { id: 'bom_mandatory', parentSkuId: parent.id, componentSkuId: mandatoryComponent.id, mandatory: true, quantity: 2, notes: '' },
      { id: 'bom_optional', parentSkuId: parent.id, componentSkuId: optionalComponent.id, mandatory: false, quantity: 1, notes: '' },
    )
  })

  it('skuTotalUnitCostWithBom adds mandatory component cost x quantity, ignoring optional components', () => {
    const skusById = new Map(data.commercialSkus.map((s) => [s.id, s]))
    // own cost 1000 + mandatory component (cost 200 x qty 2) = 1400; optional component's 300 is excluded.
    expect(skuTotalUnitCostWithBom(parent, data.commercialBomItems, skusById)).toBe(1400)
  })

  it('skuTotalUnitCostWithBom equals the plain cost when no BOM items reference the SKU', () => {
    const skusById = new Map(data.commercialSkus.map((s) => [s.id, s]))
    const standalone = { ...baseSkuInput('nope'), id: 'sku_standalone' } as CommercialSku
    expect(skuTotalUnitCostWithBom(standalone, data.commercialBomItems, skusById)).toBe(skuTotalUnitCost(standalone))
  })

  it('computeSkuMarginPercent defaults to the plain (BOM-unaware) cost when bomItems/skusById are omitted', () => {
    expect(computeSkuMarginPercent(parent)).toBe(50) // unchanged from the existing behavior
  })

  it('computeSkuMarginPercent reflects the fully-loaded cost when BOM data is supplied', () => {
    const skusById = new Map(data.commercialSkus.map((s) => [s.id, s]))
    // (2000 - 1400) / 2000 * 100 = 30%, down from the SKU's own-cost-only 50%.
    expect(computeSkuMarginPercent(parent, data.commercialBomItems, skusById)).toBe(30)
  })
})

describe('updateSkuLogic', () => {
  let data: CommercialCalculatorData
  let sku: CommercialSku
  beforeEach(() => {
    data = buildDefaultCommercialCalculatorData()
    const { feature } = seedHierarchy(data)
    sku = createSkuLogic(data, baseSkuInput(feature.id))
  })

  it('requires a changeReason when editing a cost field', () => {
    expect(() => updateSkuLogic(data, sku.id, { baseSoftwareCost: 1200 })).toThrow(/changeReason is required/i)
  })

  it('allows a non-sensitive field edit without a reason', () => {
    expect(updateSkuLogic(data, sku.id, { name: 'Renamed' }).name).toBe('Renamed')
  })

  it('writes an audit log entry when a cost field changes with a reason', () => {
    updateSkuLogic(data, sku.id, { baseSoftwareCost: 1200 }, 'Vendor cost increase')
    const entry = data.commercialAuditLogs.find((a) => a.entityId === sku.id && a.field === 'baseSoftwareCost')
    expect(entry?.oldValue).toBe('1000')
    expect(entry?.newValue).toBe('1200')
    expect(entry?.reason).toBe('Vendor cost increase')
  })
})

describe('deleteSkuLogic', () => {
  it('blocks deleting a SKU referenced by a BOM item', () => {
    const data = buildDefaultCommercialCalculatorData()
    const { feature, module_ } = seedHierarchy(data)
    const componentFeature = createMasterLogic(data, 'features', { code: 'COMP', name: 'Component Feature', description: '', moduleId: module_.id, status: 'new' })
    const parent = createSkuLogic(data, baseSkuInput(feature.id))
    const component = createSkuLogic(data, { ...baseSkuInput(componentFeature.id), name: 'Component' })
    data.commercialBomItems.push({ id: 'bom1', parentSkuId: parent.id, componentSkuId: component.id, mandatory: true, quantity: 1, notes: '' })
    expect(() => deleteSkuLogic(data, component.id)).toThrow(/still referenced/i)
  })
})

describe('generateBoqNumber', () => {
  it('is year-scoped, sequential, and zero-padded to 6 digits', () => {
    const data = buildDefaultCommercialCalculatorData()
    const year = String(new Date().getFullYear())
    expect(generateBoqNumber(data)).toBe(`BOQ-${year}-000001`)
    expect(generateBoqNumber(data)).toBe(`BOQ-${year}-000002`)
  })
})

function baseBoqInput(): CreateBoqInput {
  return {
    opportunityName: 'Test Opportunity', departmentId: 'dept1', customerName: 'ACME',
    customerOrganization: '', customerAddress: '', customerGst: '', customerContact: '',
    verticalId: 'v1', budgetAmount: '', budgetUnit: '', budgetKnown: '', emdAmount: '', emdUnit: '',
    salesPersonId: 'sp1', buSalesPersonId: null, preSalesId: null, currency: 'INR',
  }
}

describe('BOQ lifecycle', () => {
  let data: CommercialCalculatorData
  beforeEach(() => { data = buildDefaultCommercialCalculatorData() })

  it('creates a BOQ in draft with version 1 and an immutable number', () => {
    const boq = createBoqLogic(data, baseBoqInput())
    expect(boq.status).toBe('draft')
    expect(boq.boqVersion).toBe(1)
    expect(boq.revisionNumber).toBe(0)
    expect(boq.parentBoqId).toBeNull()
    expect(boq.boqNumber).toMatch(/^BOQ-\d{4}-\d{6}$/)
  })

  it('allows draft -> submitted -> under_review -> approved -> archived', () => {
    const boq = createBoqLogic(data, baseBoqInput())
    updateBoqStatusLogic(data, boq.id, 'submitted', 'submit')
    updateBoqStatusLogic(data, boq.id, 'under_review', 'review')
    updateBoqStatusLogic(data, boq.id, 'approved', 'approve')
    expect(updateBoqStatusLogic(data, boq.id, 'archived', 'archive').status).toBe('archived')
  })

  it('rejects an invalid transition, e.g. draft -> approved', () => {
    const boq = createBoqLogic(data, baseBoqInput())
    expect(() => updateBoqStatusLogic(data, boq.id, 'approved', 'x')).toThrow(/cannot transition/i)
  })

  it('blocks cancelling an already-approved BOQ (only archived is reachable)', () => {
    const boq = createBoqLogic(data, baseBoqInput())
    updateBoqStatusLogic(data, boq.id, 'submitted', 'x')
    updateBoqStatusLogic(data, boq.id, 'under_review', 'x')
    updateBoqStatusLogic(data, boq.id, 'approved', 'x')
    expect(() => updateBoqStatusLogic(data, boq.id, 'cancelled', 'x')).toThrow(/cannot transition/i)
  })

  it('defines Pending Approval by exclusion', () => {
    expect(isBoqPendingApproval('draft')).toBe(false)
    expect(isBoqPendingApproval('submitted')).toBe(true)
    expect(isBoqPendingApproval('under_review')).toBe(true)
    expect(isBoqPendingApproval('approved')).toBe(false)
  })

  it('revises a BOQ into a new row, keeping the boqNumber but bumping boqVersion', () => {
    const original = createBoqLogic(data, baseBoqInput())
    updateBoqStatusLogic(data, original.id, 'submitted', 'x')
    const revised = reviseBoqLogic(data, original.id)
    expect(revised.boqNumber).toBe(original.boqNumber)
    expect(revised.boqVersion).toBe(2)
    expect(revised.revisionNumber).toBe(0)
    expect(revised.parentBoqId).toBe(original.id)
    expect(revised.status).toBe('draft')
  })
})

describe('deleteBoqLogic', () => {
  let data: CommercialCalculatorData
  beforeEach(() => { data = buildDefaultCommercialCalculatorData() })

  it('deletes a draft BOQ and its line items', () => {
    const { feature } = seedHierarchy(data)
    const sku = createSkuLogic(data, baseSkuInput(feature.id))
    const boq = createBoqLogic(data, baseBoqInput())
    addBoqLineItemLogic(data, boq.id, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })

    deleteBoqLogic(data, boq.id)

    expect(data.commercialBoqs.some((b) => b.id === boq.id)).toBe(false)
    expect(data.commercialBoqLineItems.some((li) => li.boqId === boq.id)).toBe(false)
  })

  it('deletes a cancelled, rejected, or archived BOQ', () => {
    const cancelled = createBoqLogic(data, baseBoqInput())
    updateBoqStatusLogic(data, cancelled.id, 'cancelled', 'x')
    expect(() => deleteBoqLogic(data, cancelled.id)).not.toThrow()

    const rejected = createBoqLogic(data, baseBoqInput())
    updateBoqStatusLogic(data, rejected.id, 'submitted', 'x')
    updateBoqStatusLogic(data, rejected.id, 'under_review', 'x')
    updateBoqStatusLogic(data, rejected.id, 'rejected', 'x')
    expect(() => deleteBoqLogic(data, rejected.id)).not.toThrow()
  })

  it('rejects deleting a BOQ that is still active in the pipeline', () => {
    const boq = createBoqLogic(data, baseBoqInput())
    updateBoqStatusLogic(data, boq.id, 'submitted', 'x')
    expect(() => deleteBoqLogic(data, boq.id)).toThrow(/cancel it first/i)
    expect(data.commercialBoqs.some((b) => b.id === boq.id)).toBe(true)
  })

  it('rejects deleting an approved BOQ directly', () => {
    const boq = createBoqLogic(data, baseBoqInput())
    updateBoqStatusLogic(data, boq.id, 'submitted', 'x')
    updateBoqStatusLogic(data, boq.id, 'under_review', 'x')
    updateBoqStatusLogic(data, boq.id, 'approved', 'x')
    expect(() => deleteBoqLogic(data, boq.id)).toThrow(/cancel it first/i)
  })

  it('throws for an unknown BOQ id', () => {
    expect(() => deleteBoqLogic(data, 'nope')).toThrow(/no such boq/i)
  })
})

describe('BOQ line items — discount/approval matrix (spec §8)', () => {
  let data: CommercialCalculatorData
  let boqId: string
  let sku: CommercialSku
  beforeEach(() => {
    data = buildDefaultCommercialCalculatorData()
    const { feature } = seedHierarchy(data)
    sku = createSkuLogic(data, baseSkuInput(feature.id))
    boqId = createBoqLogic(data, baseBoqInput()).id
  })

  it('auto-approves a line within the lowest discount band', () => {
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 2, unitPrice: 2000, discountPct: 5 })
    expect(line.approvalStatus).toBe('auto_approved')
    expect(line.taxPct).toBe(18)
  })

  it('requires manual approval outside the auto-approve band', () => {
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 20 })
    expect(line.approvalStatus).toBe('pending')
  })

  it('computes lineTotal as qty * price * (1 - discount) * (1 + tax)', () => {
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 2, unitPrice: 2000, discountPct: 10 })
    expect(line.lineTotal).toBeCloseTo(2 * 2000 * 0.9 * 1.18, 5)
  })

  it('clamps discount to the SKU maximumDiscountPercent', () => {
    updateSkuLogic(data, sku.id, { maximumDiscountPercent: 30 }, 'tighten')
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 80 })
    expect(line.discountPct).toBe(30)
  })

  it('rejects a discount that would push unit price below minimumAllowedPrice', () => {
    expect(() => addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 90 }))
      .toThrow(/below this SKU's minimum allowed price/i)
  })

  it('recomputes the BOQ grandTotal as lines are added and updated', () => {
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    let boq = data.commercialBoqs.find((b) => b.id === boqId)!
    expect(boq.grandTotal).toBeCloseTo(2000 * 1.18, 5)
    updateBoqLineItemLogic(data, line.id, { quantity: 3 })
    boq = data.commercialBoqs.find((b) => b.id === boqId)!
    expect(boq.grandTotal).toBeCloseTo(3 * 2000 * 1.18, 5)
  })

  it('blocks approving the BOQ while any line has a pending discount approval', () => {
    addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 20 })
    updateBoqStatusLogic(data, boqId, 'submitted', 'x')
    updateBoqStatusLogic(data, boqId, 'under_review', 'x')
    expect(() => updateBoqStatusLogic(data, boqId, 'approved', 'x')).toThrow(/approved discount status/i)
  })

  it('allows approving the BOQ once every pending line is resolved', () => {
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 20 })
    updateBoqLineItemLogic(data, line.id, {
      approvalStatus: 'approved', approverId: 'emp_sales_head', approvalRemarks: 'ok', approvalDate: '2026-08-03',
    })
    updateBoqStatusLogic(data, boqId, 'submitted', 'x')
    updateBoqStatusLogic(data, boqId, 'under_review', 'x')
    expect(updateBoqStatusLogic(data, boqId, 'approved', 'x').status).toBe('approved')
  })

  it('does not block approving when every line auto-approved', () => {
    addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 5 })
    updateBoqStatusLogic(data, boqId, 'submitted', 'x')
    updateBoqStatusLogic(data, boqId, 'under_review', 'x')
    expect(updateBoqStatusLogic(data, boqId, 'approved', 'x').status).toBe('approved')
  })

  it('blocks approving a BOQ that has an explicitly rejected line (P0 fix — gate was pending-only)', () => {
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 20 })
    updateBoqLineItemLogic(data, line.id, { approvalStatus: 'rejected', approverId: 'emp_sales_head', approvalRemarks: 'no' })
    updateBoqStatusLogic(data, boqId, 'submitted', 'x')
    updateBoqStatusLogic(data, boqId, 'under_review', 'x')
    expect(() => updateBoqStatusLogic(data, boqId, 'approved', 'x')).toThrow(/approved discount status/i)
  })

  it('rejects a non-positive quantity when adding a line', () => {
    expect(() => addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 0, unitPrice: 2000, discountPct: 0 }))
      .toThrow(/quantity must be greater than 0/i)
    expect(() => addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: -1, unitPrice: 2000, discountPct: 0 }))
      .toThrow(/quantity must be greater than 0/i)
  })

  it('rejects a non-positive quantity when updating a line', () => {
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    expect(() => updateBoqLineItemLogic(data, line.id, { quantity: 0 })).toThrow(/quantity must be greater than 0/i)
  })

  it('editing discountPct on an approved line resets status, approver, date, and remarks together', () => {
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 20 })
    updateBoqLineItemLogic(data, line.id, {
      approvalStatus: 'approved', approverId: 'emp_sales_head', approvalRemarks: 'ok', approvalDate: '2026-08-03',
    })
    const edited = updateBoqLineItemLogic(data, line.id, { discountPct: 5 })
    expect(edited.approvalStatus).toBe('auto_approved') // 5% is inside the auto-approve band
    expect(edited.approverId).toBeNull()
    expect(edited.approvalDate).toBeNull()
    expect(edited.approvalRemarks).toBe('')
  })

  it('editing quantity alone does not touch approval state', () => {
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 20 })
    updateBoqLineItemLogic(data, line.id, {
      approvalStatus: 'approved', approverId: 'emp_sales_head', approvalRemarks: 'ok', approvalDate: '2026-08-03',
    })
    const edited = updateBoqLineItemLogic(data, line.id, { quantity: 3 })
    expect(edited.approvalStatus).toBe('approved')
    expect(edited.approverId).toBe('emp_sales_head')
  })

  it('writes one audit entry for a quantity edit, with old/new values and no required reason', () => {
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    updateBoqLineItemLogic(data, line.id, { quantity: 4 })
    const entries = data.commercialAuditLogs.filter((a) => a.entityId === line.id)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      entityType: 'boqLineItem', field: 'quantity', oldValue: '1', newValue: '4', action: 'update', reason: '', changedBy: null,
    })
  })

  it('writes one audit entry for a discountPct edit', () => {
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 5 })
    updateBoqLineItemLogic(data, line.id, { discountPct: 15 })
    const entries = data.commercialAuditLogs.filter((a) => a.entityId === line.id)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ entityType: 'boqLineItem', field: 'discountPct', oldValue: '5', newValue: '15' })
  })

  it('writes two audit entries when quantity and discountPct change in the same call', () => {
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 5 })
    updateBoqLineItemLogic(data, line.id, { quantity: 2, discountPct: 15 })
    const entries = data.commercialAuditLogs.filter((a) => a.entityId === line.id)
    expect(entries.map((e) => e.field).sort()).toEqual(['discountPct', 'quantity'])
  })

  it('writes no audit entry when a patch does not actually change the value', () => {
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 5 })
    updateBoqLineItemLogic(data, line.id, { quantity: 1 })
    expect(data.commercialAuditLogs.filter((a) => a.entityId === line.id)).toHaveLength(0)
  })

  it('does not audit adding or removing a line', () => {
    const before = data.commercialAuditLogs.length
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 5 })
    removeBoqLineItemLogic(data, line.id)
    expect(data.commercialAuditLogs).toHaveLength(before)
  })
})

describe('BOQ approval status on revise/duplicate (P0 fix)', () => {
  let data: CommercialCalculatorData
  let sku: CommercialSku

  beforeEach(() => {
    data = buildDefaultCommercialCalculatorData()
    const { feature } = seedHierarchy(data)
    sku = createSkuLogic(data, baseSkuInput(feature.id))
  })

  it('reviseBoqLogic recomputes a rejected line as fresh (not carried-over) approval state', () => {
    const original = createBoqLogic(data, baseBoqInput())
    const line = addBoqLineItemLogic(data, original.id, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 20 })
    updateBoqLineItemLogic(data, line.id, { approvalStatus: 'rejected', approverId: 'emp_sales_head', approvalRemarks: 'no', approvalDate: '2026-08-01' })
    updateBoqStatusLogic(data, original.id, 'submitted', 'x')

    const revised = reviseBoqLogic(data, original.id)
    const revisedLine = data.commercialBoqLineItems.find((li) => li.boqId === revised.id)!
    expect(revisedLine.approvalStatus).toBe('pending') // 20% is outside the auto-approve band
    expect(revisedLine.approverId).toBeNull()
    expect(revisedLine.approvalDate).toBeNull()
    expect(revisedLine.approvalRemarks).toBe('')
  })

  it('reviseBoqLogic keeps an auto-approved line auto-approved rather than forcing pending', () => {
    const original = createBoqLogic(data, baseBoqInput())
    addBoqLineItemLogic(data, original.id, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 5 })
    const revised = reviseBoqLogic(data, original.id)
    const revisedLine = data.commercialBoqLineItems.find((li) => li.boqId === revised.id)!
    expect(revisedLine.approvalStatus).toBe('auto_approved')
  })

  it('duplicateBoqLogic recomputes a rejected line as fresh approval state', () => {
    const original = createBoqLogic(data, baseBoqInput())
    const line = addBoqLineItemLogic(data, original.id, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 20 })
    updateBoqLineItemLogic(data, line.id, { approvalStatus: 'rejected', approverId: 'emp_sales_head', approvalRemarks: 'no' })

    const duplicate = duplicateBoqLogic(data, original.id)
    const duplicateLine = data.commercialBoqLineItems.find((li) => li.boqId === duplicate.id)!
    expect(duplicateLine.approvalStatus).toBe('pending')
    expect(duplicateLine.approverId).toBeNull()
  })

  it('a revised BOQ with a resolved recomputed line can be approved end-to-end', () => {
    const original = createBoqLogic(data, baseBoqInput())
    const line = addBoqLineItemLogic(data, original.id, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 20 })
    updateBoqLineItemLogic(data, line.id, { approvalStatus: 'rejected', approverId: 'emp_sales_head', approvalRemarks: 'no' })
    updateBoqStatusLogic(data, original.id, 'submitted', 'x')

    const revised = reviseBoqLogic(data, original.id)
    const revisedLine = data.commercialBoqLineItems.find((li) => li.boqId === revised.id)!
    updateBoqStatusLogic(data, revised.id, 'submitted', 'x')
    updateBoqStatusLogic(data, revised.id, 'under_review', 'x')
    expect(() => updateBoqStatusLogic(data, revised.id, 'approved', 'x')).toThrow(/approved discount status/i)

    updateBoqLineItemLogic(data, revisedLine.id, { approvalStatus: 'approved', approverId: 'emp_sales_head', approvalRemarks: 'ok', approvalDate: '2026-08-03' })
    expect(updateBoqStatusLogic(data, revised.id, 'approved', 'x').status).toBe('approved')
  })
})

describe('BOQ line items — multi-currency conversion (P0 fix)', () => {
  // Seeded currencies: INR (base, exchangeRate 1), USD (exchangeRate 83).
  let data: CommercialCalculatorData
  let boqId: string // BOQ currency: INR
  beforeEach(() => {
    data = buildDefaultCommercialCalculatorData()
    boqId = createBoqLogic(data, baseBoqInput()).id
  })

  it('leaves a same-currency line unconverted (factor 1)', () => {
    const { feature } = seedHierarchy(data)
    const sku = createSkuLogic(data, baseSkuInput(feature.id)) // currencyId: cur_inr
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 2, unitPrice: 2000, discountPct: 10 })
    expect(line.lineTotal).toBeCloseTo(2 * 2000 * 0.9 * 1.18, 5)
  })

  it('converts a line priced in a different currency into the BOQ currency', () => {
    const { feature } = seedHierarchy(data)
    const sku = createSkuLogic(data, { ...baseSkuInput(feature.id), currencyId: 'cur_usd' })
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    // 2000 USD * 1.18 tax = 2360 USD; converted to INR at exchangeRate 83 => 195,880.
    expect(line.lineTotal).toBeCloseTo(2360 * 83, 5)
  })

  it('sums a multi-currency BOQ grand total in the BOQ currency, not raw addition', () => {
    const { feature, module_ } = seedHierarchy(data)
    const inrFeature = createMasterLogic(data, 'features', { code: 'INRF', name: 'INR Feature', description: '', moduleId: module_.id, status: 'new' })
    const inrSku = createSkuLogic(data, baseSkuInput(inrFeature.id)) // cur_inr
    const usdSku = createSkuLogic(data, { ...baseSkuInput(feature.id), currencyId: 'cur_usd' })
    addBoqLineItemLogic(data, boqId, { skuId: inrSku.id, quantity: 1, unitPrice: 2000, discountPct: 0 }) // 2360 INR
    addBoqLineItemLogic(data, boqId, { skuId: usdSku.id, quantity: 1, unitPrice: 2000, discountPct: 0 }) // 2360 USD -> 195,880 INR
    const boq = data.commercialBoqs.find((b) => b.id === boqId)!
    expect(boq.grandTotal).toBeCloseTo(2360 + 2360 * 83, 5)
  })

  it('does not let a currency-conversion factor affect the minimum-allowed-price floor check', () => {
    const { feature } = seedHierarchy(data)
    // floorPrice 1400 USD; a 90% discount off a 100 USD unitPrice is well under
    // the floor regardless of currency, and must still be rejected in USD terms.
    const sku = createSkuLogic(data, { ...baseSkuInput(feature.id), currencyId: 'cur_usd' })
    expect(() => addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 90 }))
      .toThrow(/below this SKU's minimum allowed price/i)
  })

  it('re-converts on update when quantity/discount change', () => {
    const { feature } = seedHierarchy(data)
    const sku = createSkuLogic(data, { ...baseSkuInput(feature.id), currencyId: 'cur_usd' })
    const line = addBoqLineItemLogic(data, boqId, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    const updated = updateBoqLineItemLogic(data, line.id, { quantity: 3 })
    expect(updated.lineTotal).toBeCloseTo(3 * 2360 * 83, 5)
  })
})

describe('computeBoqMarginPercent', () => {
  it('computes margin from discounted revenue vs SKU cost across lines', () => {
    const data = buildDefaultCommercialCalculatorData()
    const { feature } = seedHierarchy(data)
    const sku = createSkuLogic(data, baseSkuInput(feature.id)) // cost 1000, listPrice 2000
    const boq = createBoqLogic(data, baseBoqInput())
    const line = addBoqLineItemLogic(data, boq.id, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    const margin = computeBoqMarginPercent(boq, [line], new Map([[sku.id, sku]]), data.masters.currencies)
    expect(margin).toBeCloseTo(50, 5)
  })

  it('returns 0 for zero revenue rather than dividing by zero', () => {
    const data = buildDefaultCommercialCalculatorData()
    const boq = createBoqLogic(data, baseBoqInput())
    expect(computeBoqMarginPercent(boq, [], new Map(), data.masters.currencies)).toBe(0)
  })

  it('folds a line SKU\'s mandatory BOM component cost into the blended margin when bomItems is supplied', () => {
    const data = buildDefaultCommercialCalculatorData()
    const { feature, module_ } = seedHierarchy(data)
    const parent = createSkuLogic(data, baseSkuInput(feature.id)) // cost 1000, listPrice 2000
    const componentFeature = createMasterLogic(data, 'features', { code: 'COMP', name: 'Component', description: '', moduleId: module_.id, status: 'new' })
    const component = createSkuLogic(data, { ...baseSkuInput(componentFeature.id), name: 'Component', baseSoftwareCost: 200 })
    data.commercialBomItems.push({ id: 'bom1', parentSkuId: parent.id, componentSkuId: component.id, mandatory: true, quantity: 2, notes: '' })
    const boq = createBoqLogic(data, baseBoqInput())
    const line = addBoqLineItemLogic(data, boq.id, { skuId: parent.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    const skusById = new Map([[parent.id, parent], [component.id, component]])

    const marginWithoutBom = computeBoqMarginPercent(boq, [line], skusById, data.masters.currencies)
    const marginWithBom = computeBoqMarginPercent(boq, [line], skusById, data.masters.currencies, data.commercialBomItems)
    expect(marginWithoutBom).toBeCloseTo(50, 5) // unchanged default behavior
    expect(marginWithBom).toBeCloseTo(30, 5) // (2000 - 1400) / 2000 * 100
  })

  it('converts each line into the BOQ currency before blending margin across lines', () => {
    // Deliberately asymmetric margins/currencies: an unconverted (buggy) sum
    // would blend revenue/cost 1:1 across INR and raw USD numbers and land on
    // 63.33%; converting each line into INR first (USD's 83x weight
    // dominating the blend) must land on 89.06% instead.
    const data = buildDefaultCommercialCalculatorData()
    const { feature, module_ } = seedHierarchy(data)
    const inrFeature = createMasterLogic(data, 'features', { code: 'INRF', name: 'INR Feature', description: '', moduleId: module_.id, status: 'new' })
    const inrSku = createSkuLogic(data, baseSkuInput(inrFeature.id)) // cost 1000, listPrice 2000, INR -> 50% margin
    const usdSku = createSkuLogic(data, {
      ...baseSkuInput(feature.id), currencyId: 'cur_usd', baseSoftwareCost: 100, listPrice: 1000, floorPrice: 500,
    }) // cost 100, listPrice 1000, USD -> 90% margin
    const boq = createBoqLogic(data, baseBoqInput()) // BOQ currency INR
    const inrLine = addBoqLineItemLogic(data, boq.id, { skuId: inrSku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    const usdLine = addBoqLineItemLogic(data, boq.id, { skuId: usdSku.id, quantity: 1, unitPrice: 1000, discountPct: 0 })
    const skusById = new Map([[inrSku.id, inrSku], [usdSku.id, usdSku]])
    const margin = computeBoqMarginPercent(boq, [inrLine, usdLine], skusById, data.masters.currencies)
    expect(margin).toBeCloseTo(89.058823529, 5)
  })
})

describe('listBoqLineItemsLogic / listBoqsLogic / getBoqLogic — live pricing while a BOQ is draft', () => {
  it('recomputes a draft line\'s unitPrice/taxPct/lineTotal from the SKU\'s current price, not the stored snapshot', () => {
    const data = buildDefaultCommercialCalculatorData()
    const { feature } = seedHierarchy(data)
    const sku = createSkuLogic(data, baseSkuInput(feature.id)) // listPrice 2000, tax_gst18
    const boq = createBoqLogic(data, baseBoqInput())
    addBoqLineItemLogic(data, boq.id, { skuId: sku.id, quantity: 2, unitPrice: 2000, discountPct: 0 })

    updateSkuLogic(data, sku.id, { listPrice: 3000, taxClassId: 'tax_gst5' }, 'price change')

    const [line] = listBoqLineItemsLogic(data, boq.id)
    expect(line.unitPrice).toBe(3000)
    expect(line.taxPct).toBe(5)
    expect(line.lineTotal).toBeCloseTo(2 * 3000 * 1.05, 5)
  })

  it('leaves a submitted BOQ\'s line at its frozen snapshot even after the SKU price changes', () => {
    const data = buildDefaultCommercialCalculatorData()
    const { feature } = seedHierarchy(data)
    const sku = createSkuLogic(data, baseSkuInput(feature.id)) // listPrice 2000, tax_gst18
    const boq = createBoqLogic(data, baseBoqInput())
    addBoqLineItemLogic(data, boq.id, { skuId: sku.id, quantity: 2, unitPrice: 2000, discountPct: 0 })
    updateBoqStatusLogic(data, boq.id, 'submitted', 'send to customer')

    updateSkuLogic(data, sku.id, { listPrice: 3000, taxClassId: 'tax_gst5' }, 'price change')

    const [line] = listBoqLineItemsLogic(data, boq.id)
    expect(line.unitPrice).toBe(2000)
    expect(line.taxPct).toBe(18)
    expect(line.lineTotal).toBeCloseTo(2 * 2000 * 1.18, 5)
  })

  it('recomputes grandTotal for a draft BOQ via listBoqsLogic and getBoqLogic', () => {
    const data = buildDefaultCommercialCalculatorData()
    const { feature } = seedHierarchy(data)
    const sku = createSkuLogic(data, baseSkuInput(feature.id)) // listPrice 2000
    const boq = createBoqLogic(data, baseBoqInput())
    addBoqLineItemLogic(data, boq.id, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })

    updateSkuLogic(data, sku.id, { listPrice: 5000 }, 'price change')

    expect(getBoqLogic(data, boq.id)?.grandTotal).toBeCloseTo(5000 * 1.18, 5)
    expect(listBoqsLogic(data).find((b) => b.id === boq.id)?.grandTotal).toBeCloseTo(5000 * 1.18, 5)
  })

  it('does not recompute grandTotal for a non-draft BOQ', () => {
    const data = buildDefaultCommercialCalculatorData()
    const { feature } = seedHierarchy(data)
    const sku = createSkuLogic(data, baseSkuInput(feature.id)) // listPrice 2000
    const boq = createBoqLogic(data, baseBoqInput())
    addBoqLineItemLogic(data, boq.id, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    updateBoqStatusLogic(data, boq.id, 'submitted', 'send to customer')
    const beforeTotal = getBoqLogic(data, boq.id)?.grandTotal

    updateSkuLogic(data, sku.id, { listPrice: 5000 }, 'price change')

    expect(getBoqLogic(data, boq.id)?.grandTotal).toBe(beforeTotal)
  })
})
