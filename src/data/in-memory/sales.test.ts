import { describe, it, expect, beforeEach } from 'vitest'
import { repository, resetLocalData } from '@/data/repository'

// 2026-09-02, task 6.2. Mirrors apps/api/src/routers/sales.ts's
// `updatePostingManager` procedure (task 6.1) — an in-place manager change on
// the currently-open posting, distinct from `transferSalesPerson`'s
// close-then-insert. Verifies the in-memory repository produces the same
// observable result as the Postgres version for an equivalent scenario.
describe('InMemoryRepository.updatePostingManager', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('updates manager_id on the open posting, leaving other fields untouched', async () => {
    const manager = await repository.createSalesPerson({
      name: 'Manager', officialEmail: 'manager@example.com', designation: 'RM', tierKey: 'rm',
    })
    const newManager = await repository.createSalesPerson({
      name: 'New Manager', officialEmail: 'new-manager@example.com', designation: 'RM', tierKey: 'rm',
    })
    const person = await repository.createSalesPerson({
      name: 'Report', officialEmail: 'report@example.com', designation: 'Account Manager', tierKey: 'accountManager',
      managerId: manager.id,
    })
    const [before] = await repository.listSalesPostings(person.id)

    const updated = await repository.updatePostingManager(person.id, { managerId: newManager.id })

    expect(updated.managerId).toBe(newManager.id)
    expect(updated.id).toBe(before.id)
    expect(updated.startDate).toBe(before.startDate)
    expect(updated.endDate).toBeNull()
    expect(updated.designation).toBe(before.designation)
    expect(updated.tierKey).toBe(before.tierKey)
    expect(updated.changeType).toBe(before.changeType)
  })

  it('accepts managerId: null to remove a manager', async () => {
    const manager = await repository.createSalesPerson({
      name: 'Manager', officialEmail: 'manager2@example.com', designation: 'RM', tierKey: 'rm',
    })
    const person = await repository.createSalesPerson({
      name: 'Report', officialEmail: 'report2@example.com', designation: 'Account Manager', tierKey: 'accountManager',
      managerId: manager.id,
    })

    const updated = await repository.updatePostingManager(person.id, { managerId: null })
    expect(updated.managerId).toBeNull()
  })

  it('throws when the person has no open posting', async () => {
    const person = await repository.createSalesPerson({
      name: 'Report', officialEmail: 'report3@example.com', designation: 'Account Manager', tierKey: 'accountManager',
    })
    await repository.deleteSalesPerson(person.id)
    await expect(repository.updatePostingManager(person.id, { managerId: null })).rejects.toThrow(/no open posting/i)
  })

  // Item 1: gmOverrideId is independently settable — a change to one field
  // must never disturb the other on the same open posting.
  it('sets gmOverrideId without touching managerId when only gmOverrideId is passed', async () => {
    const manager = await repository.createSalesPerson({
      name: 'Manager', officialEmail: 'manager4@example.com', designation: 'RM', tierKey: 'rm',
    })
    const gm = await repository.createSalesPerson({
      name: 'GM', officialEmail: 'gm4@example.com', designation: 'GM', tierKey: 'rm',
    })
    const person = await repository.createSalesPerson({
      name: 'Report', officialEmail: 'report4@example.com', designation: 'Account Manager', tierKey: 'accountManager',
      managerId: manager.id,
    })

    const updated = await repository.updatePostingManager(person.id, { gmOverrideId: gm.id })

    expect(updated.gmOverrideId).toBe(gm.id)
    expect(updated.managerId).toBe(manager.id)
  })

  it('accepts gmOverrideId: null to revert to auto-derivation', async () => {
    const gm = await repository.createSalesPerson({
      name: 'GM', officialEmail: 'gm5@example.com', designation: 'GM', tierKey: 'rm',
    })
    const person = await repository.createSalesPerson({
      name: 'Report', officialEmail: 'report5@example.com', designation: 'Account Manager', tierKey: 'accountManager',
    })
    await repository.updatePostingManager(person.id, { gmOverrideId: gm.id })

    const updated = await repository.updatePostingManager(person.id, { gmOverrideId: null })
    expect(updated.gmOverrideId).toBeNull()
  })
})

// Mirrors apps/api's `updatePostingDates` — both delegate the boundary rules
// to @goms/domain's planPostingDatesEdit, so this only proves the in-memory
// repository applies the plan the same way (incl. moving the previous
// posting's end to keep history contiguous).
describe('InMemoryRepository.updatePostingDates', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  async function personWithHistory() {
    const person = await repository.createSalesPerson({
      name: 'Dates Person', officialEmail: 'dates@example.com', designation: 'Account Manager', tierKey: 'accountManager',
    })
    const [initial] = await repository.listSalesPostings(person.id)
    await repository.updatePostingDates(initial.id, { startDate: '2024-01-01' })
    await repository.transferSalesPerson({
      salesPersonId: person.id, designation: 'Regional Manager', tierKey: 'rm', effectiveDate: '2025-07-01',
    })
    const postings = await repository.listSalesPostings(person.id)
    return {
      person,
      current: postings.find((p) => p.endDate === null)!,
      previous: postings.find((p) => p.endDate !== null)!,
    }
  }

  it('moving the current start moves the previous end so history stays contiguous', async () => {
    const { person, current, previous } = await personWithHistory()
    await repository.updatePostingDates(current.id, { startDate: '2025-09-15' })
    const postings = await repository.listSalesPostings(person.id)
    expect(postings.find((p) => p.id === current.id)!.startDate).toBe('2025-09-15')
    expect(postings.find((p) => p.id === previous.id)!.endDate).toBe('2025-09-15')
  })

  it('a last day held ends the posting (exclusive end = last day + 1) and clearing it reopens', async () => {
    const { person, current } = await personWithHistory()
    const ended = await repository.updatePostingDates(current.id, { lastDayHeld: '2026-03-31' })
    expect(ended.endDate).toBe('2026-04-01')
    expect((await repository.currentPostings())[person.id]).toBeUndefined()
    const reopened = await repository.updatePostingDates(current.id, { lastDayHeld: null })
    expect(reopened.endDate).toBeNull()
  })

  it('rejects bad boundaries and leaves both postings unchanged', async () => {
    const { person, current, previous } = await personWithHistory()
    await expect(repository.updatePostingDates(current.id, { lastDayHeld: '2025-06-30' })).rejects.toThrow(/on or after Effective from/)
    await expect(repository.updatePostingDates(previous.id, { lastDayHeld: null })).rejects.toThrow(/open-ended/)
    const postings = await repository.listSalesPostings(person.id)
    expect(postings.find((p) => p.id === current.id)).toMatchObject({ startDate: '2025-07-01', endDate: null })
    expect(postings.find((p) => p.id === previous.id)).toMatchObject({ startDate: '2024-01-01', endDate: '2025-07-01' })
  })
})
