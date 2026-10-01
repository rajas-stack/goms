import { describe, it, expect, beforeEach } from 'vitest'
import { repository, resetLocalData } from '@/data/repository'

async function newBid(name = 'Smart Bus') {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name, submissionDate: '2099-01-15' })
  return repository.createBid(opp.id)
}

// The in-memory repository mirrors apps/api's bidCustomFields router, so local dev
// behaves like the deployed app for the structured and entity-backed column types.
describe('InMemoryRepository custom column types', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('only select and multiselect take options (and need at least one)', async () => {
    await expect(repository.createBidCustomField({ name: 'Regions', dataType: 'multiselect' })).rejects.toThrow(/at least one option/)
    await expect(repository.createBidCustomField({ name: 'Budget', dataType: 'currency', options: ['x'] })).rejects.toThrow(/Only a select or multi-select/)
    const regions = await repository.createBidCustomField({ name: 'Regions', dataType: 'multiselect', options: ['West', 'North'] })
    expect(regions.options).toEqual(['West', 'North'])
    const budget = await repository.createBidCustomField({ name: 'Budget', dataType: 'currency' })
    await expect(repository.updateBidCustomField(budget.id, { options: ['a'] })).rejects.toThrow(/Only a select or multi-select/)
    expect((await repository.updateBidCustomField(regions.id, { options: ['West'] })).options).toEqual(['West'])
  })

  it('validates and normalises each structured type on write', async () => {
    const bid = await newBid()
    const set = async (name: string, dataType: 'currency' | 'url' | 'email' | 'phone', value: string | number) => {
      const f = await repository.createBidCustomField({ name, dataType })
      return { f, result: repository.setBidCustomValue(bid.id, f.id, value) }
    }
    expect((await (await set('Budget', 'currency', '₹5,00,000')).result).value).toBe(500000)
    expect((await (await set('Site', 'url', 'gem.gov.in')).result).value).toBe('https://gem.gov.in')
    expect((await (await set('Mail', 'email', 'A@B.CO')).result).value).toBe('a@b.co')
    expect((await (await set('Phone', 'phone', '+91 98765 43210')).result).value).toBe('+919876543210')
    await expect((await set('Mail2', 'email', 'nope')).result).rejects.toThrow(/valid email/)
    await expect((await set('Site2', 'url', 'ftp://x.y')).result).rejects.toThrow(/valid web address/)
  })

  it('stores a multi-select as its chosen options, in option order', async () => {
    const bid = await newBid()
    const f = await repository.createBidCustomField({ name: 'Regions', dataType: 'multiselect', options: ['West', 'North', 'South'] })
    await repository.setBidCustomValue(bid.id, f.id, JSON.stringify(['South', 'West']))
    expect((await repository.listBidCustomValues(bid.id)).regions).toBe('["West","South"]')
    await expect(repository.setBidCustomValue(bid.id, f.id, '["East"]')).rejects.toThrow(/not one of/)
    await repository.setBidCustomValue(bid.id, f.id, '[]') // empty clears
    expect((await repository.listBidCustomValues(bid.id)).regions).toBeUndefined()
  })

  it('person / department / state reference real records, are stored as their id, and log the NAME', async () => {
    const bid = await newBid()
    const person = await repository.createSalesPerson({ name: 'Asha Rao', officialEmail: 'asha@amnex.com', designation: 'RM', tierKey: 'rm' })
    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Health Dept' })
    const [state] = await repository.listStates()

    const lead = await repository.createBidCustomField({ name: 'Lead', dataType: 'person' })
    const nodal = await repository.createBidCustomField({ name: 'Nodal Dept', dataType: 'department' })
    const where = await repository.createBidCustomField({ name: 'Where', dataType: 'state' })

    await repository.setBidCustomValue(bid.id, lead.id, person.id)
    await repository.setBidCustomValue(bid.id, nodal.id, dept.id)
    await repository.setBidCustomValue(bid.id, where.id, state.code)
    const values = await repository.listBidCustomValues(bid.id)
    expect(values).toMatchObject({ lead: person.id, nodal_dept: dept.id, where: state.code })

    await expect(repository.setBidCustomValue(bid.id, lead.id, 'no-such-person')).rejects.toThrow(/person does not exist/)
    await expect(repository.setBidCustomValue(bid.id, nodal.id, 'no-such-dept')).rejects.toThrow(/department does not exist/)
    await expect(repository.setBidCustomValue(bid.id, where.id, 99999)).rejects.toThrow(/state does not exist/)

    const log = await repository.listAuditLogs({ entityType: 'bidCustomFieldValue', entityId: bid.id })
    const byField = (key: string) => log.find((l) => l.field === key)!
    expect(byField('lead').newValue).toBe('Asha Rao')
    expect(byField('nodal_dept').newValue).toBe('Health Dept')
    expect(byField('where').newValue).toBe(state.name)
  })

  it('filters entity and multi-select columns', async () => {
    const [a, b] = [await newBid('Alpha'), await newBid('Beta')]
    const p1 = await repository.createSalesPerson({ name: 'P One', officialEmail: 'p1@amnex.com', designation: 'RM', tierKey: 'rm' })
    const p2 = await repository.createSalesPerson({ name: 'P Two', officialEmail: 'p2@amnex.com', designation: 'RM', tierKey: 'rm' })
    const lead = await repository.createBidCustomField({ name: 'Lead', dataType: 'person' })
    const regions = await repository.createBidCustomField({ name: 'Regions', dataType: 'multiselect', options: ['West', 'North'] })
    await repository.setBidCustomValue(a.id, lead.id, p1.id)
    await repository.setBidCustomValue(b.id, lead.id, p2.id)
    await repository.setBidCustomValue(a.id, regions.id, '["West"]')
    await repository.setBidCustomValue(b.id, regions.id, '["North"]')
    const names = async (rules: Parameters<typeof repository.listBidsForGrid>[0]) => (await repository.listBidsForGrid(rules)).map((r) => r.opportunityName)
    expect(await names([{ field: 'custom:lead', operator: 'eq', value: p1.id }])).toEqual(['Alpha'])
    expect(await names([{ field: 'custom:regions', operator: 'in', value: '', values: ['North'] }])).toEqual(['Beta'])
    // (Lead = P One) OR (Regions includes North), as a group.
    const either = await names([{ logic: 'or', rules: [
      { field: 'custom:lead', operator: 'eq', value: p1.id },
      { field: 'custom:regions', operator: 'eq', value: 'North' },
    ] }])
    expect(either.sort()).toEqual(['Alpha', 'Beta'])
  })

  it('logs an inline City / Sector / name edit against the bid, and marks the bid updated', async () => {
    const bid = await newBid()
    const before = (await repository.getBid(bid.id))!.updatedAt
    await new Promise((r) => setTimeout(r, 5))
    await repository.updateOpportunity(bid.opportunityId, { city: 'Pune', vertical: 'Smart City' })
    await repository.updateOpportunity(bid.opportunityId, { city: 'Pune' }) // unchanged: not an edit
    const log = await repository.listAuditLogs({ entityType: 'bid', entityId: bid.id })
    expect(log.map((l) => [l.field, l.oldValue, l.newValue]).sort()).toEqual([['city', '', 'Pune'], ['vertical', '', 'Smart City']])
    expect((await repository.getBid(bid.id))!.updatedAt >= before).toBe(true)
  })

  it('a column holding values is archive-only unless deleted together with its values', async () => {
    const bid = await newBid()
    const f = await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
    await repository.setBidCustomValue(bid.id, f.id, 'x')
    await expect(repository.deleteBidCustomField(f.id)).rejects.toThrow(/archive it instead/)
    await repository.deleteBidCustomField(f.id, true)
    expect(await repository.listBidCustomFields(true)).toEqual([])
    expect(await repository.listBidCustomValues(bid.id)).toEqual({})
  })
})
