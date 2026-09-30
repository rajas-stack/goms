import { describe, it, expect, beforeEach } from 'vitest'
import { repository, resetLocalData } from '@/data/repository'

async function newBid(name = 'Smart Bus') {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: name, submissionDate: '2099-01-15' })
  return repository.createBid(opp.id)
}

// Mirrors apps/api's bidCustomFields router rules so local dev (no backend)
// behaves the same as the deployed app.
describe('InMemoryRepository custom columns', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('creates columns with deduped immutable keys and rejects a duplicate active name', async () => {
    const a = await repository.createBidCustomField({ name: 'Client Contact', dataType: 'text' })
    await expect(repository.createBidCustomField({ name: ' client contact ', dataType: 'text' })).rejects.toThrow(/already exists/)
    await repository.archiveBidCustomField(a.id)
    const b = await repository.createBidCustomField({ name: 'Client Contact', dataType: 'number' })
    expect(a.key).toBe('client_contact')
    expect(b.key).toBe('client_contact_2')
    expect(await repository.listBidCustomFields()).toEqual([b])
    expect((await repository.listBidCustomFields(true)).map((f) => f.id)).toEqual([a.id, b.id])
    await expect(repository.unarchiveBidCustomField(a.id)).rejects.toThrow(/already named/)
  })

  it('validates select options, and rename/options edits never touch key or type', async () => {
    await expect(repository.createBidCustomField({ name: 'Tier', dataType: 'select' })).rejects.toThrow(/at least one option/)
    await expect(repository.createBidCustomField({ name: 'Note', dataType: 'text', options: ['x'] })).rejects.toThrow(/Only a select/)
    const tier = await repository.createBidCustomField({ name: 'Tier', dataType: 'select', options: ['Gold', ' gold ', 'Silver'] })
    expect(tier.options).toEqual(['Gold', 'Silver'])
    const renamed = await repository.updateBidCustomField(tier.id, { name: 'Level', options: ['Gold'] })
    expect(renamed).toMatchObject({ name: 'Level', key: 'tier', dataType: 'select', options: ['Gold'] })
    const note = await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
    await expect(repository.updateBidCustomField(note.id, { options: ['a'] })).rejects.toThrow(/Only a select/)
  })

  it('reorder needs exactly the active ids and rewrites positions', async () => {
    const a = await repository.createBidCustomField({ name: 'A', dataType: 'text' })
    const b = await repository.createBidCustomField({ name: 'B', dataType: 'text' })
    const c = await repository.createBidCustomField({ name: 'C', dataType: 'text' })
    await expect(repository.reorderBidCustomFields([a.id, b.id])).rejects.toThrow(/exactly/)
    const out = await repository.reorderBidCustomFields([c.id, a.id, b.id])
    expect(out.map((f) => f.name)).toEqual(['C', 'A', 'B'])
  })

  it('stores typed values, one per bid+field, and clearing removes the value', async () => {
    const bid = await newBid()
    const num = await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
    const date = await repository.createBidCustomField({ name: 'Review', dataType: 'date' })
    const flag = await repository.createBidCustomField({ name: 'Hot', dataType: 'boolean' })
    await repository.setBidCustomValue(bid.id, num.id, '12.5')
    await repository.setBidCustomValue(bid.id, num.id, 13)
    await repository.setBidCustomValue(bid.id, date.id, '2026-10-31')
    await repository.setBidCustomValue(bid.id, flag.id, false)
    expect(await repository.listBidCustomValues(bid.id)).toEqual({ score: 13, review: '2026-10-31', hot: false })
    await repository.setBidCustomValue(bid.id, num.id, '')
    expect(await repository.listBidCustomValues(bid.id)).toEqual({ review: '2026-10-31', hot: false })
    await expect(repository.setBidCustomValue(bid.id, num.id, 'abc')).rejects.toThrow(/valid number/)
    await expect(repository.setBidCustomValue(bid.id, date.id, '2026-02-30')).rejects.toThrow(/valid date/)
  })

  it('archive hides values from the grid but keeps them; archived columns reject writes; unarchive restores', async () => {
    const bid = await newBid()
    const score = await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
    await repository.setBidCustomValue(bid.id, score.id, 42)
    await repository.archiveBidCustomField(score.id)
    expect((await repository.listBidsForGrid())[0].customValues).toEqual({})
    await expect(repository.setBidCustomValue(bid.id, score.id, 1)).rejects.toThrow(/archived/)
    await repository.unarchiveBidCustomField(score.id)
    expect((await repository.listBidsForGrid())[0].customValues).toEqual({ score: 42 })
  })

  it('delete is allowed only for a column that has NEVER held a value — clearing does not make it deletable', async () => {
    const bid = await newBid()
    const kept = await repository.createBidCustomField({ name: 'Kept', dataType: 'text' })
    const cleared = await repository.createBidCustomField({ name: 'Cleared', dataType: 'text' })
    const unused = await repository.createBidCustomField({ name: 'Unused', dataType: 'number' })
    expect(unused.hasHeldValue).toBe(false)
    await repository.setBidCustomValue(bid.id, kept.id, 'x')
    await repository.setBidCustomValue(bid.id, cleared.id, 'x')
    await repository.setBidCustomValue(bid.id, cleared.id, null) // row removed, flag stays
    await expect(repository.setBidCustomValue(bid.id, unused.id, 'abc')).rejects.toThrow() // invalid write never marks it
    await expect(repository.deleteBidCustomField(kept.id)).rejects.toThrow(/archive it instead/)
    await expect(repository.deleteBidCustomField(cleared.id)).rejects.toThrow(/archive it instead/)
    await repository.deleteBidCustomField(unused.id)
    expect((await repository.listBidCustomFields(true)).map((f) => f.id).sort()).toEqual([kept.id, cleared.id].sort())
    await repository.archiveBidCustomField(cleared.id) // archiving stays available
  })

  it('filters the grid with typed operators; a rule on an archived column is skipped', async () => {
    const [a, b, c] = [await newBid('Alpha'), await newBid('Beta'), await newBid('Gamma')]
    const score = await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
    const note = await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
    await repository.setBidCustomValue(a.id, score.id, 9)
    await repository.setBidCustomValue(b.id, score.id, 10)
    await repository.setBidCustomValue(c.id, score.id, 100)
    await repository.setBidCustomValue(a.id, note.id, 'Fast track')
    const names = async (rules: any[]) => (await repository.listBidsForGrid(rules)).map((r) => r.opportunityName).sort()
    expect(await names([{ field: 'custom:score', operator: 'gt', value: '9' }])).toEqual(['Beta', 'Gamma'])
    expect(await names([{ field: 'custom:score', operator: 'between', value: '9', value2: '10' }])).toEqual(['Alpha', 'Beta'])
    expect(await names([{ field: 'custom:note', operator: 'contains', value: 'FAST' }])).toEqual(['Alpha'])
    await repository.archiveBidCustomField(note.id)
    expect(await names([{ field: 'custom:note', operator: 'contains', value: 'zzz' }])).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('audits definition changes and keys value edits to the bid (same store as commercial audit logs)', async () => {
    const bid = await newBid()
    const f = await repository.createBidCustomField({ name: 'Score', dataType: 'number' })
    await repository.updateBidCustomField(f.id, { name: 'Points' })
    await repository.archiveBidCustomField(f.id)
    await repository.unarchiveBidCustomField(f.id)
    await repository.setBidCustomValue(bid.id, f.id, 1)
    await repository.setBidCustomValue(bid.id, f.id, 2)
    await repository.setBidCustomValue(bid.id, f.id, 2)
    await repository.setBidCustomValue(bid.id, f.id, null)
    const defs = await repository.listAuditLogs({ entityType: 'bidCustomField' })
    expect(defs.map((r) => r.action).sort()).toEqual(
      ['custom_field_archived', 'custom_field_created', 'custom_field_renamed', 'custom_field_unarchived'],
    )
    const values = await repository.listAuditLogs({ entityType: 'bidCustomFieldValue', entityId: bid.id })
    expect(values.map((r) => [r.action, r.oldValue, r.newValue]).sort()).toEqual([
      ['custom_value_cleared', '2', ''],
      ['custom_value_set', '', '1'],
      ['custom_value_set', '1', '2'],
    ])
  })

  it('deleting a bid removes its custom values', async () => {
    const bid = await newBid()
    const f = await repository.createBidCustomField({ name: 'Note', dataType: 'text' })
    await repository.setBidCustomValue(bid.id, f.id, 'x')
    await repository.deleteBid(bid.id)
    // The bid's value rows are gone, but the column DID hold a value: archive-only.
    await expect(repository.deleteBidCustomField(f.id)).rejects.toThrow(/archive it instead/)
    expect((await repository.listBidCustomFields(true)).map((x) => x.id)).toEqual([f.id])
  })
})
