import { describe, expect, it } from 'vitest'
import { buildProposalPrintHtml } from './proposal-print'
import type { CommercialBoq, CommercialBoqLineItem, CommercialSku } from './types'

function baseBoq(overrides: Partial<CommercialBoq> = {}): CommercialBoq {
  return {
    id: 'boq1', boqNumber: 'BOQ-2026-000001', opportunityName: 'State Portal Rollout', departmentId: 'dept1',
    customerName: 'ACME Corp', customerOrganization: 'ACME Org', customerAddress: '1 Main St', customerGst: 'GST123',
    customerContact: '9999999999', verticalId: 'v1', budgetAmount: '', budgetUnit: '', budgetKnown: '',
    emdAmount: '', emdUnit: '', salesPersonId: 'sp1', buSalesPersonId: null, preSalesId: null,
    status: 'draft', boqVersion: 1, revisionNumber: 0, parentBoqId: null, currency: 'INR', grandTotal: 2360,
    createdAt: '2026-08-01T00:00:00.000Z', createdBy: null, lastModifiedAt: '2026-08-01T00:00:00.000Z', lastModifiedBy: null,
    ...overrides,
  }
}

function baseLine(overrides: Partial<CommercialBoqLineItem> = {}): CommercialBoqLineItem {
  return {
    id: 'line1', boqId: 'boq1', skuId: 'sku1', quantity: 1, unitPrice: 2000, discountPct: 0, taxPct: 18,
    approverId: null, approvalDate: null, approvalRemarks: '', approvalStatus: 'auto_approved', lineTotal: 2360,
    ...overrides,
  }
}

function baseSku(overrides: Partial<CommercialSku> = {}): CommercialSku {
  return {
    id: 'sku1', skuCode: 'GOV-GOMS-AM-HIER-NEW', name: 'Hierarchy Tree Feature', categoryId: 'cat1', featureId: 'f1',
    editionId: 'ped_standard', uomId: 'uom1', currencyId: 'cur_inr', taxClassId: 'tax1', billingTypeId: 'bil1',
    activeFrom: '2026-01-01', activeTill: null, lifecycleStatus: 'active', isSellable: true, displayOrder: 0,
    baseSoftwareCost: 1000, implementationCostPerMM: 0, integrationCost: 0, thirdPartyCost: 0, hardwareCost: 0,
    cloudCost: 0, supportCost: 0, trainingCost: 0, internalPrice: 1500, floorPrice: 1400, partnerPrice: 1600,
    governmentPrice: 1700, enterprisePrice: 1800, corporatePrice: 1900, listPrice: 2000, minimumAllowedPrice: 1400,
    maximumDiscountPercent: 90, createdAt: '2026-01-01T00:00:00.000Z', createdBy: null,
    ...overrides,
  }
}

describe('buildProposalPrintHtml', () => {
  it('includes the BOQ number, opportunity, and customer details', () => {
    const html = buildProposalPrintHtml({
      boq: baseBoq(), lines: [], skuById: new Map(), departmentName: 'IT Dept', verticalName: 'Government', salesPersonName: 'Jane Doe',
    })
    expect(html).toContain('BOQ-2026-000001')
    expect(html).toContain('State Portal Rollout')
    expect(html).toContain('ACME Corp')
    expect(html).toContain('IT Dept')
    expect(html).toContain('Government')
    expect(html).toContain('Jane Doe')
  })

  it('includes each line item\'s SKU code, quantity, and line total', () => {
    const sku = baseSku()
    const line = baseLine()
    const html = buildProposalPrintHtml({
      boq: baseBoq(), lines: [line], skuById: new Map([[sku.id, sku]]),
      departmentName: 'IT Dept', verticalName: 'Government', salesPersonName: 'Jane Doe',
    })
    expect(html).toContain('GOV-GOMS-AM-HIER-NEW')
    expect(html).toContain('Hierarchy Tree Feature')
    expect(html).toContain('2,360') // toLocaleString formatting of the line total
  })

  it('includes the grand total with the BOQ currency code', () => {
    const html = buildProposalPrintHtml({
      boq: baseBoq({ currency: 'USD', grandTotal: 9999 }), lines: [], skuById: new Map(),
      departmentName: '', verticalName: '', salesPersonName: '',
    })
    expect(html).toContain('USD')
    expect(html).toContain('9,999')
  })

  it('falls back to a dash for an unresolved SKU rather than throwing', () => {
    const html = buildProposalPrintHtml({
      boq: baseBoq(), lines: [baseLine({ skuId: 'missing-sku' })], skuById: new Map(),
      departmentName: '', verticalName: '', salesPersonName: '',
    })
    expect(html).toContain('Unknown SKU')
  })

  it('escapes HTML in free-text fields rather than injecting it raw', () => {
    const html = buildProposalPrintHtml({
      boq: baseBoq({ customerName: '<script>alert(1)</script>' }), lines: [], skuById: new Map(),
      departmentName: '', verticalName: '', salesPersonName: '',
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
