import { beforeEach, describe, expect, it } from 'vitest'
import { buildDefaultCommercialCalculatorData } from './seed-defaults'
import { createMasterLogic } from './repository-logic'
import {
  addBoqLineItemLogic, computeBoqMarginPercent, computeSkuMarginPercent, createBoqLogic, createSkuLogic,
  deleteSkuLogic, generateBoqNumber, generateSkuCode, isBoqPendingApproval, reviseBoqLogic, updateBoqLineItemLogic,
  updateBoqStatusLogic, updateSkuLogic,
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
})

describe('computeBoqMarginPercent', () => {
  it('computes margin from discounted revenue vs SKU cost across lines', () => {
    const data = buildDefaultCommercialCalculatorData()
    const { feature } = seedHierarchy(data)
    const sku = createSkuLogic(data, baseSkuInput(feature.id)) // cost 1000, listPrice 2000
    const boq = createBoqLogic(data, baseBoqInput())
    const line = addBoqLineItemLogic(data, boq.id, { skuId: sku.id, quantity: 1, unitPrice: 2000, discountPct: 0 })
    const margin = computeBoqMarginPercent(boq, [line], new Map([[sku.id, sku]]))
    expect(margin).toBeCloseTo(50, 5)
  })

  it('returns 0 for zero revenue rather than dividing by zero', () => {
    const data = buildDefaultCommercialCalculatorData()
    const boq = createBoqLogic(data, baseBoqInput())
    expect(computeBoqMarginPercent(boq, [], new Map())).toBe(0)
  })
})
