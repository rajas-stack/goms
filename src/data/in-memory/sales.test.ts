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

    const updated = await repository.updatePostingManager(person.id, newManager.id)

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

    const updated = await repository.updatePostingManager(person.id, null)
    expect(updated.managerId).toBeNull()
  })

  it('throws when the person has no open posting', async () => {
    const person = await repository.createSalesPerson({
      name: 'Report', officialEmail: 'report3@example.com', designation: 'Account Manager', tierKey: 'accountManager',
    })
    await repository.deleteSalesPerson(person.id)
    await expect(repository.updatePostingManager(person.id, null)).rejects.toThrow(/no open posting/i)
  })
})
