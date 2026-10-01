import { describe, expect, it } from 'vitest'
import { MIGRATIONS, SCHEMA_VERSION, migrateSnapshot } from './migrations'
import { buildDefaultCommercialCalculatorData } from '@/modules/commercial-calculator/seed-defaults'

/** A minimal v1 snapshot — the shape shipped before Phase 0. */
function v1Snapshot() {
  return {
    nodes: [
      { id: 'org_a', domain: 'org', typeKey: 'department', parentId: null, stateCode: 1,
        name: 'Agriculture', code: null, sortOrder: 0, metadata: {}, status: 'active' },
    ],
    employees: [],
    externalIds: [],
    timeline: [],
    transfers: [],
  }
}

describe('migrateSnapshot', () => {
  it('returns the data unchanged when already at the current version', () => {
    const current = migrateSnapshot(v1Snapshot(), SCHEMA_VERSION)
    expect(current).not.toBeNull()
    expect(current!.nodes).toHaveLength(1)
  })

  it('migrates a v1 snapshot all the way forward', () => {
    const out = migrateSnapshot(v1Snapshot(), 1)
    expect(out).not.toBeNull()
    expect(Array.isArray(out!.opportunities)).toBe(true)
    expect(Array.isArray(out!.opportunityStageChanges)).toBe(true)
    expect(Array.isArray(out!.followUps)).toBe(true)
  })

  it('preserves existing collections while migrating', () => {
    const out = migrateSnapshot(v1Snapshot(), 1)
    expect(out!.nodes).toHaveLength(1)
    expect(out!.nodes[0].name).toBe('Agriculture')
  })

  it('discards a snapshot from a NEWER build than this one', () => {
    expect(migrateSnapshot(v1Snapshot(), SCHEMA_VERSION + 1)).toBeNull()
  })

  it('discards a snapshot with a nonsensical version', () => {
    expect(migrateSnapshot(v1Snapshot(), 0)).toBeNull()
    expect(migrateSnapshot(v1Snapshot(), -3)).toBeNull()
  })

  it('discards a snapshot that is not an object', () => {
    expect(migrateSnapshot(null, 1)).toBeNull()
    expect(migrateSnapshot('nope', 1)).toBeNull()
    expect(migrateSnapshot([], 1)).toBeNull()
  })

  it('discards rather than throwing when a step fails', () => {
    // `nodes` missing entirely — the v2 step iterates it.
    expect(migrateSnapshot({ employees: [] }, 1)).toBeNull()
  })

  it('has a migration step for every version above 1', () => {
    for (let v = 2; v <= SCHEMA_VERSION; v++) {
      expect(MIGRATIONS[v], `missing migration to v${v}`).toBeTypeOf('function')
    }
  })

  it('adds the Commercial Calculator data slice with default seed data when migrating an old snapshot', () => {
    const out = migrateSnapshot(v1Snapshot(), 1)
    expect(out).not.toBeNull()
    expect(out!.commercialCalculator.masters.skuCategories).toHaveLength(12)
    expect(out!.commercialCalculator.masters.currencies.find((c) => c.code === 'INR')?.isBaseCurrency).toBe(true)
    expect(out!.commercialCalculator.productEditionFeatures).toEqual([])
  })

  it('does not clobber an existing commercialCalculator slice if one is already present', () => {
    const withData = {
      ...v1Snapshot(),
      commercialCalculator: { masters: { verticals: [{ id: 'v1', code: 'X', name: 'X', description: '', active: true, displayOrder: 0 }] }, productEditionFeatures: [] },
    }
    const out = migrateSnapshot(withData, 1)
    expect(out).not.toBeNull()
    expect(out!.commercialCalculator.masters.verticals).toHaveLength(1)
    expect((out!.commercialCalculator.masters.verticals[0] as { code: string }).code).toBe('X')
  })

  it('backfills the Phase 2+3 SKU/BOM/BOQ/audit-log collections onto a v8-shaped snapshot', () => {
    const v8Shaped = {
      ...v1Snapshot(),
      commercialCalculator: {
        masters: { verticals: [{ id: 'v1', code: 'X', name: 'X', description: '', active: true, displayOrder: 0 }] },
        productEditionFeatures: [],
      },
    }
    const out = migrateSnapshot(v8Shaped, 8)
    expect(out).not.toBeNull()
    // Pre-existing fields are preserved untouched.
    expect(out!.commercialCalculator.masters.verticals).toHaveLength(1)
    // New Phase 2+3 fields are backfilled with the same defaults a fresh
    // build gets — commercialSkus isn't `[]` here since seed-defaults.ts
    // ships sample SKUs so Create BOQ works end-to-end out of the box.
    expect(out!.commercialCalculator.commercialSkus).toEqual(buildDefaultCommercialCalculatorData().commercialSkus)
    expect(out!.commercialCalculator.commercialBomItems).toEqual([])
    expect(out!.commercialCalculator.commercialBoqs).toEqual([])
    expect(out!.commercialCalculator.commercialBoqLineItems).toEqual([])
    expect(out!.commercialCalculator.commercialAuditLogs).toEqual([])
    expect(out!.commercialCalculator.boqSequenceByYear).toEqual({})
  })

  it('does not clobber existing Phase 2+3 data if a snapshot already has it', () => {
    const withSkus = {
      ...v1Snapshot(),
      commercialCalculator: {
        ...(migrateSnapshot(v1Snapshot(), 1)!.commercialCalculator),
        commercialSkus: [{ id: 'sku1', skuCode: 'X-Y-Z-F-NEW' }],
        boqSequenceByYear: { '2026': 5 },
      },
    }
    const out = migrateSnapshot(withSkus, SCHEMA_VERSION)
    expect(out).not.toBeNull()
    expect(out).toBe(withSkus) // already at SCHEMA_VERSION — returned unchanged
  })

  it('adds an empty customers array when migrating an old snapshot', () => {
    const out = migrateSnapshot(v1Snapshot(), 1)
    expect(out).not.toBeNull()
    expect(out!.customers).toEqual([])
  })

  it('does not clobber an existing customers array if one is already present', () => {
    const withCustomers = { ...v1Snapshot(), customers: [{ id: 'cust_1', name: 'Acme' }] }
    const out = migrateSnapshot(withCustomers, 9)
    expect(out).not.toBeNull()
    expect(out!.customers).toEqual([{ id: 'cust_1', name: 'Acme' }])
  })

  it('adds empty Bid Tracker collections when migrating an old snapshot', () => {
    const out = migrateSnapshot(v1Snapshot(), 1)
    expect(out).not.toBeNull()
    expect(out!.bids).toEqual([])
    expect(out!.bidMilestones).toEqual([])
    expect(out!.bidCorrigenda).toEqual([])
    expect(out!.bidCorrigendumChanges).toEqual([])
    expect(out!.protectedValues).toEqual([])
    expect(out!.bidDocuments).toEqual([])
    expect(out!.documentCitations).toEqual([])
    expect(out!.bidSavedViews).toEqual([])
  })

  it('adds empty custom-column collections (v14), including when coming from v13', () => {
    const fromV1 = migrateSnapshot(v1Snapshot(), 1)
    expect(fromV1!.bidCustomFields).toEqual([])
    expect(fromV1!.bidCustomFieldValues).toEqual([])
    const fromV13 = migrateSnapshot({ ...v1Snapshot(), bids: [] }, 13)
    expect(fromV13!.bidCustomFields).toEqual([])
    expect(fromV13!.bidCustomFieldValues).toEqual([])
  })

  it('backfills hasHeldValue (v15) from whether a column has value rows, and keeps an existing flag', () => {
    const snap = {
      ...v1Snapshot(),
      bidCustomFields: [{ id: 'used', key: 'a' }, { id: 'unused', key: 'b' }, { id: 'flagged', key: 'c', hasHeldValue: true }],
      bidCustomFieldValues: [{ bidId: 'x', fieldId: 'used', value: 1 }],
    }
    const out = migrateSnapshot(snap, 14)
    expect((out!.bidCustomFields as any[]).map((f) => [f.id, f.hasHeldValue])).toEqual([['used', true], ['unused', false], ['flagged', true]])
  })

  it('does not clobber existing custom-column data', () => {
    const existing = { ...v1Snapshot(), bidCustomFields: [{ id: 'cf1', key: 'score' }], bidCustomFieldValues: [{ bidId: 'b', fieldId: 'cf1', value: 3 }] }
    const out = migrateSnapshot(existing, 13)
    expect(out!.bidCustomFields).toEqual([{ id: 'cf1', key: 'score', hasHeldValue: true }])
    expect(out!.bidCustomFieldValues).toHaveLength(1)
  })

  it('does not clobber existing Bid Tracker data if a snapshot already has it', () => {
    const withBids = { ...v1Snapshot(), bids: [{ id: 'bid_1', bidCode: 'BID-2026-0001' }] }
    const out = migrateSnapshot(withBids, 12)
    expect(out).not.toBeNull()
    expect(out!.bids).toEqual([{ id: 'bid_1', bidCode: 'BID-2026-0001' }])
  })

  it('backfills selectedPricingLevels onto a legacy SKU row that predates the field', () => {
    const legacy = {
      ...v1Snapshot(),
      commercialCalculator: {
        ...(migrateSnapshot(v1Snapshot(), 1)!.commercialCalculator),
        commercialSkus: [{ id: 'sku1', skuCode: 'X-Y-Z-F-NEW' }],
      },
    }
    const out = migrateSnapshot(legacy, 10)
    expect(out).not.toBeNull()
    expect(out!.commercialCalculator.commercialSkus).toEqual([{ id: 'sku1', skuCode: 'X-Y-Z-F-NEW', selectedPricingLevels: [] }])
  })

  it('does not clobber a SKU that already has selectedPricingLevels', () => {
    const withLevels = {
      ...v1Snapshot(),
      commercialCalculator: {
        ...(migrateSnapshot(v1Snapshot(), 1)!.commercialCalculator),
        commercialSkus: [{ id: 'sku1', skuCode: 'X-Y-Z-F-NEW', selectedPricingLevels: [{ level: 'internal', maximumDiscountPercent: 10 }] }],
      },
    }
    const out = migrateSnapshot(withLevels, 10)
    expect(out).not.toBeNull()
    expect(out!.commercialCalculator.commercialSkus).toEqual([
      { id: 'sku1', skuCode: 'X-Y-Z-F-NEW', selectedPricingLevels: [{ level: 'internal', maximumDiscountPercent: 10 }] },
    ])
  })

  it('backfills pricingLevels/activePricingLevel onto a legacy BOQ line item that predates the field', () => {
    const legacy = {
      ...v1Snapshot(),
      commercialCalculator: {
        ...(migrateSnapshot(v1Snapshot(), 1)!.commercialCalculator),
        commercialBoqLineItems: [{ id: 'li1', boqId: 'boq1', skuId: 'sku1' }],
      },
    }
    const out = migrateSnapshot(legacy, 11)
    expect(out).not.toBeNull()
    expect(out!.commercialCalculator.commercialBoqLineItems).toEqual([
      { id: 'li1', boqId: 'boq1', skuId: 'sku1', pricingLevels: [], activePricingLevel: null },
    ])
  })

  it('does not clobber a BOQ line item that already has pricingLevels', () => {
    const withLevels = {
      ...v1Snapshot(),
      commercialCalculator: {
        ...(migrateSnapshot(v1Snapshot(), 1)!.commercialCalculator),
        commercialBoqLineItems: [{
          id: 'li1', boqId: 'boq1', skuId: 'sku1',
          pricingLevels: [{ level: 'internal', sellingPrice: 900 }], activePricingLevel: 'internal',
        }],
      },
    }
    const out = migrateSnapshot(withLevels, 11)
    expect(out).not.toBeNull()
    expect(out!.commercialCalculator.commercialBoqLineItems).toEqual([{
      id: 'li1', boqId: 'boq1', skuId: 'sku1',
      pricingLevels: [{ level: 'internal', sellingPrice: 900 }], activePricingLevel: 'internal',
    }])
  })
})

describe('v2 — opportunities extracted from department metadata', () => {
  it('moves a legacy works blob into the opportunities collection', () => {
    const snap = v1Snapshot()
    snap.nodes[0].metadata = {
      works: JSON.stringify([{
        id: 'work_1', opportunityName: 'ATCS rollout', gemTenderId: 'GEM/1',
        publishDate: '2026-01-01', submissionDate: '2026-02-01', vertical: 'Traffic',
        component: ['Hardware'], quantity: '10', currency: 'INR',
        valueAmount: '50', valueUnit: 'lakh', budgetKnown: 'yes',
        emdAmount: '', emdUnit: 'lakh', salesPersonEmail: 'rohitt@amnex.com',
      }]),
    }

    const out = migrateSnapshot(snap, 1)!
    expect(out.opportunities).toHaveLength(1)
    expect(out.opportunities[0]).toMatchObject({
      id: 'work_1',
      departmentId: 'org_a',
      stateCode: 1,
      opportunityName: 'ATCS rollout',
      stageKey: 'pipeline',
      closedOn: null,
      salesPersonEmail: 'rohitt@amnex.com',
    })
  })

  it('deletes the legacy metadata key so it cannot be read again', () => {
    const snap = v1Snapshot()
    snap.nodes[0].metadata = { works: JSON.stringify([]), shortName: 'DoA' }
    const out = migrateSnapshot(snap, 1)!
    expect(out.nodes[0].metadata.works).toBeUndefined()
    expect(out.nodes[0].metadata.shortName).toBe('DoA')
  })

  it('writes NO stage-change rows for migrated opportunities', () => {
    // Their real stage history is unknown. Fabricating one would put false
    // data into the analytics substrate.
    const snap = v1Snapshot()
    snap.nodes[0].metadata = {
      works: JSON.stringify([{ id: 'work_1', opportunityName: 'X', component: [] }]),
    }
    const out = migrateSnapshot(snap, 1)!
    expect(out.opportunityStageChanges).toHaveLength(0)
  })

  it('survives malformed works JSON by dropping it', () => {
    const snap = v1Snapshot()
    snap.nodes[0].metadata = { works: '{not json' }
    const out = migrateSnapshot(snap, 1)!
    expect(out.opportunities).toHaveLength(0)
    expect(out.nodes[0].metadata.works).toBeUndefined()
  })

  it('migrates a legacy single-string component to an array', () => {
    const snap = v1Snapshot()
    snap.nodes[0].metadata = {
      works: JSON.stringify([{ id: 'w', opportunityName: 'X', component: 'Hardware' }]),
    }
    const out = migrateSnapshot(snap, 1)!
    expect(out.opportunities[0].component).toEqual(['Hardware'])
  })
})

describe('v3 — follow-ups extracted from employees', () => {
  it('creates a FollowUp row for each employee with a followUpDate', () => {
    const snap = v1Snapshot()
    snap.employees = [
      { id: 'emp_1', name: 'A', followUpDate: '2026-08-01', status: 'active' },
      { id: 'emp_2', name: 'B', followUpDate: null, status: 'active' },
    ] as never
    const out = migrateSnapshot(snap, 1)!
    expect(out.followUps).toHaveLength(1)
    expect(out.followUps[0]).toMatchObject({
      entityType: 'contact',
      entityId: 'emp_1',
      dueDate: '2026-08-01',
      status: 'open',
      assigneeId: null,
    })
  })

  it('leaves employee.followUpDate in place for Phase 3 to remove', () => {
    const snap = v1Snapshot()
    snap.employees = [{ id: 'emp_1', name: 'A', followUpDate: '2026-08-01', status: 'active' }] as never
    const out = migrateSnapshot(snap, 1)!
    expect((out.employees[0] as { followUpDate?: string }).followUpDate).toBe('2026-08-01')
  })
})
