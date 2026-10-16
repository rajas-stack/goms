import { beforeAll, describe, expect, it } from 'vitest'
import { DATASETS, runQuery, COUNT_FIELD } from '@goms/domain'
import { repository, resetLocalData } from '@/data/repository'
import { DATASET_FETCHERS } from './fetchers'

/** Catalog ↔ platform integrity, against the real local store: every source has a reader, every non-derived field
 *  is a key of the rows that reader produces, and a sheet's source only ever holds that sheet's records. */

const rowsOf: Record<string, Awaited<ReturnType<(typeof DATASET_FETCHERS)[string]>>> = {}

beforeAll(async () => {
  await resetLocalData()
  const tracker = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Bus', submissionDate: '2026-08-01', vertical: 'Mobility', valueAmount: '12', valueUnit: 'cr' } as never)
  await repository.createBid(tracker.id, undefined, 'bidTracker')
  const campaign = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'City GIS', submissionDate: '2026-09-01', vertical: 'Mobility', valueAmount: '5', valueUnit: 'cr' } as never)
  const bid = await repository.createBid(campaign.id, undefined, 'campaign')
  await repository.createBidMilestone({ bidId: bid.id, milestoneType: 'custom', label: 'Pre-bid meeting', dueAt: '2026-01-10T10:00:00.000Z' } as never)
  await repository.createCompetitor({ name: 'SAS', verticals: ['BFSI'], offerings: ['MDM'] })
  await repository.createCustomer({ name: 'Acme', organization: 'Acme Ltd' } as never)
  await repository.createTenderWebsite({ name: 'GeM', url: 'https://gem.gov.in' } as never)
  for (const sheet of ['pipeline-funnel', 'pipeline-backup', 'pipeline-commits'] as const) {
    const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: `Pipe ${sheet}`, submissionDate: '2026-12-01' } as never)
    await repository.createBid(opp.id, undefined, sheet)
  }
  await repository.createFollowUp({ entityType: 'opportunity', entityId: tracker.id, dueDate: '2026-01-01' })
  await repository.createMakerDocument({ kind: 'document', title: 'H1 plan' })
  for (const d of DATASETS) rowsOf[d.id] = await DATASET_FETCHERS[d.id](repository)
})

describe('Insights Studio data adapters', () => {
  it('has a reader for every catalogued source', () => {
    expect(DATASETS.filter((d) => !DATASET_FETCHERS[d.id]).map((d) => d.id)).toEqual([])
  })

  it.each(DATASETS.map((d) => [d.id, d] as const))('%s rows carry every non-derived field', (id, dataset) => {
    const rows = rowsOf[id]
    if (!rows.length) return // nothing seeded locally for this source; covered by the typed row builders
    const keys = new Set(Object.keys(rows[0]))
    expect(dataset.fields.filter((f) => !f.derive && !keys.has(f.key)).map((f) => f.key)).toEqual([])
    expect(() => runQuery(rows, { datasetId: id, dimensions: [], measures: [{ field: COUNT_FIELD, agg: 'count' }], filters: [] }, { today: '2026-10-15' })).not.toThrow()
  })

  it('keeps sheet lineage: Bid Tracker never includes Campaign rows even with same-named attributes', () => {
    const names = (id: string) => rowsOf[id].map((r) => r.name)
    expect(names('opportunities.bidTracker')).toContain('Smart Bus')
    expect(names('opportunities.bidTracker')).not.toContain('City GIS')
    expect(names('opportunities.campaign')).toEqual(['City GIS'])
    expect(names('opportunities.master')).toEqual(expect.arrayContaining(['Smart Bus', 'City GIS']))
    expect(rowsOf['opportunities.bidTracker'].every((r) => r.sheet === 'bidTracker')).toBe(true)
  })

  it('derives INR crore values and never exposes tender website addresses or credentials', () => {
    const result = runQuery(rowsOf['opportunities.master'], { datasetId: 'opportunities.master', dimensions: [], measures: [{ field: 'valueCr', agg: 'sum' }], filters: [{ field: 'vertical', op: 'eq', value: 'Mobility' }] }, { today: '2026-10-15' })
    expect(result.rows[0].sum_valueCr).toBe(17)
    for (const row of rowsOf.tenderWebsites) expect(Object.keys(row).some((k) => /url|credential/i.test(k) && k !== 'hasCredentials')).toBe(false)
  })

  it('seeds enough people data for the Employees breakdowns', () => {
    const byTeam = runQuery(rowsOf.employees, { datasetId: 'employees', dimensions: [{ field: 'team' }], measures: [{ field: COUNT_FIELD, agg: 'count' }], filters: [] }, { today: '2026-10-15' })
    expect(byTeam.rows.length).toBeGreaterThan(1)
  })
})

describe('local seed coverage', () => {
  it('exercises the row builders of the seeded sources', () => {
    expect(DATASETS.filter((d) => !rowsOf[d.id].length).map((d) => d.id)).toEqual(['bidCorrigenda', 'commercialBoqs'])
  })
})

describe('typed row builders without local seed data', () => {
  it('builds Corrigenda and BOQ rows with every non-derived field', async () => {
    const { corrigendumRows } = await import('./opportunityRows')
    const { boqRows } = await import('./otherRows')
    const corrigenda = corrigendumRows([{ id: 'c1', bidId: 'b1', bidCode: 'B-1', sheet: 'bidTracker', opportunityName: 'Smart Bus', corrigendumNumber: 1, status: 'pending_review', reviewStatus: 'pending', impactLevel: 'high', technicalImpact: true, commercialImpact: false, submissionDateImpact: true, changeCount: 2, pendingChanges: 1, detectedAt: '2026-05-01T00:00:00Z', publishedDate: '2026-04-30' }])
    const boqs = boqRows([{ id: 'q1', boqNumber: 'BOQ-1', opportunityName: 'Smart Bus', customerName: 'GSRTC', status: 'draft', currency: 'INR', salesPersonId: 's1', boqVersion: 1, revisionNumber: 0, grandTotal: 5e7, createdAt: '2026-05-01', lastModifiedAt: '2026-05-02' } as never], { get: () => 'Asha' })
    for (const [id, rows] of [['bidCorrigenda', corrigenda], ['commercialBoqs', boqs]] as const) {
      const keys = new Set(Object.keys(rows[0]))
      expect(DATASETS.find((d) => d.id === id)!.fields.filter((f) => !f.derive && !keys.has(f.key)).map((f) => f.key), id).toEqual([])
    }
    expect(runQuery(boqs, { datasetId: 'commercialBoqs', dimensions: [], measures: [{ field: 'grandTotalCr', agg: 'sum' }], filters: [] }, { today: '2026-10-15' }).rows[0].sum_grandTotalCr).toBe(5)
  })
})
