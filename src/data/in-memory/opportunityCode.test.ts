import { describe, it, expect, beforeEach } from 'vitest'
import { repository, resetLocalData } from '@/data/repository'
import { MIGRATIONS } from '@/data/migrations'

// The human-readable Opportunity ID in the local store: generated once on
// create from the per-FY counter, carried onto the bid grid row, locked after.
describe('InMemoryRepository — Opportunity ID', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  async function gujaratDept(shortName = 'DST') {
    return repository.createNode({
      domain: 'org', typeKey: 'department', parentId: null, stateCode: 24, name: 'Science and Technology',
      metadata: { shortName },
    })
  }

  it('assigns the code on create, one counter per fiscal year, no leading zeros', async () => {
    const dept = await gujaratDept()
    const base = { departmentId: dept.id, vertical: 'Data Fabric & AI', opportunityType: 'RFP', component: ['DL'] }
    const a = await repository.createOpportunity({ ...base, opportunityName: 'A', submissionDate: '15-08-2026 14:00 Hrs' })
    const b = await repository.createOpportunity({ ...base, opportunityName: 'B', submissionDate: '2026-11-02' })
    const c = await repository.createOpportunity({ ...base, opportunityName: 'C', submissionDate: '2027-05-02' })
    expect(a.opportunityCode).toBe('FY27-Q2-DF-WEST-GJ-DST-RFP-DL-1')
    expect(b.opportunityCode).toBe('FY27-Q3-DF-WEST-GJ-DST-RFP-DL-2')
    expect(c.opportunityCode).toBe('FY28-Q1-DF-WEST-GJ-DST-RFP-DL-1')
    expect(a.opportunityType).toBe('RFP')
  })

  it('never changes the code afterwards, and refuses a patch that would', async () => {
    const dept = await gujaratDept()
    const opp = await repository.createOpportunity({ departmentId: dept.id, opportunityName: 'A', submissionDate: '2026-08-15' })
    const code = opp.opportunityCode
    await repository.updateOpportunity(opp.id, { vertical: 'GIS', submissionDate: '2027-01-01', opportunityType: 'EOI' })
    expect((await repository.getOpportunity(opp.id))!.opportunityCode).toBe(code)
    await expect(repository.updateOpportunity(opp.id, { opportunityCode: 'FY27-X-1' })).rejects.toThrow(/cannot be changed/)
  })

  it('creates a new opportunity with its bid under the chosen department, and shows the code on the grid row', async () => {
    const dept = await gujaratDept('GIDC')
    const bid = await repository.createBidForNewOpportunity(
      { opportunityName: 'New', submissionDate: '2026-10-10', opportunityType: 'Tender' },
      { mode: 'existing', departmentId: dept.id },
    )
    const [row] = await repository.listBidsForGrid()
    expect(row.id).toBe(bid.id)
    expect(row.opportunityCode).toBe('FY27-Q3-NA-WEST-GJ-GIDC-TND-NA-1')
    expect(row.opportunityType).toBe('Tender')
  })

  it('v20 backfills codes in creation order and leaves existing codes alone', () => {
    const out = MIGRATIONS[20]({
      nodes: [{ id: 'd1', name: 'Urban Development', metadata: {}, stateCode: 27 }],
      opportunities: [
        { id: 'o2', departmentId: 'd1', stateCode: 27, createdAt: '2026-06-02', submissionDate: '', vertical: 'GIS', component: [] },
        { id: 'o1', departmentId: 'd1', stateCode: 27, createdAt: '2026-06-01', submissionDate: 'TBD', vertical: 'GIS', component: [] },
        { id: 'o3', opportunityCode: 'FY27-Q1-KEEP-1', departmentId: 'd1', stateCode: 27, createdAt: '2026-05-01', submissionDate: '', vertical: '', component: [] },
      ],
    })
    const codes = Object.fromEntries((out.opportunities as { id: string; opportunityCode: string; opportunityType: string }[])
      .map((o) => [o.id, `${o.opportunityCode}|${o.opportunityType}`]))
    expect(codes).toEqual({
      o3: 'FY27-Q1-KEEP-1|',
      o1: 'FY27-Q1-GIS-WEST-MH-UD-NA-NA-2|',
      o2: 'FY27-Q1-GIS-WEST-MH-UD-NA-NA-3|',
    })
    expect(out.opportunityCodeSequences).toEqual({ FY27: 4 })
  })
})
