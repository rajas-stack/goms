import { beforeEach, describe, expect, it } from 'vitest'
import { getFullSnapshot, repository, resetLocalData } from '@/data/repository'
import { migrateSnapshot } from '@/data/migrations'

const clientRange = () => getFullSnapshot().directoryIdRanges.find((r) => r.categoryKey === 'clientDepartment')!

describe('Directory IDs (browser store)', () => {
  beforeEach(async () => { await resetLocalData() })

  it('gives every seeded and new Account Mapping person the next Client Departments number', async () => {
    const seeded = getFullSnapshot().employees.filter((e) => !e.vacant)
    expect(seeded.every((e) => typeof e.directoryNumber === 'number')).toBe(true)
    expect(new Set(seeded.map((e) => e.directoryNumber)).size).toBe(seeded.length)

    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    const next = clientRange().nextValue
    const a = await repository.createEmployee({ name: 'A', designation: 'x', email: '', phone: '', orgNodeId: dept.id, managerId: null })
    const b = await repository.createEmployee({ name: 'B', designation: 'x', email: '', phone: '', orgNodeId: dept.id, managerId: null })
    expect([a.directoryNumber, b.directoryNumber]).toEqual([next, next + 1])
  })

  it('numbers a vacant seat only once it is filled, and never lets a patch overwrite the ID', async () => {
    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    const seat = await repository.createEmployee({ name: 'Vacant', designation: 'x', email: '', phone: '', orgNodeId: dept.id, managerId: null, vacant: true })
    expect(seat.directoryNumber).toBeNull()
    const next = clientRange().nextValue
    const filled = await repository.updateEmployee(seat.id, { vacant: false, name: 'Now filled' })
    expect(filled.directoryNumber).toBe(next)
    const tampered = await repository.updateEmployee(seat.id, { directoryNumber: 1 })
    expect(tampered.directoryNumber).toBe(next)
  })

  it('refuses to issue a number beyond the range end', async () => {
    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    const snapshot = getFullSnapshot()
    snapshot.directoryIdRanges = snapshot.directoryIdRanges.map((r) => (r.categoryKey === 'clientDepartment' ? { ...r, nextValue: 6001 } : r))
    const { restoreFromBackup } = await import('@/data/repository')
    restoreFromBackup(snapshot)
    await expect(repository.createEmployee({ name: 'Over', designation: 'x', email: '', phone: '', orgNodeId: dept.id, managerId: null }))
      .rejects.toThrow('All 5,000 IDs for this category are used.')
  })

  it('gives a new Directory Type the next range and keeps it through rename, delete and re-add', async () => {
    const created = await repository.createMaster('directoryTypes', { code: 'govt', name: 'Govt Bodies', description: '' } as never)
    const range = () => getFullSnapshot().directoryIdRanges.find((r) => r.categoryKey === 'govt')
    expect(range()).toMatchObject({ rangeStart: 26001, rangeEnd: 31000, nextValue: 26001 })
    await repository.updateMaster('directoryTypes', created.id, { name: 'Government Bodies' } as never)
    await expect(repository.updateMaster('directoryTypes', created.id, { code: 'gov2' } as never)).rejects.toThrow("code can't change")
    await repository.deleteMaster('directoryTypes', created.id)
    await repository.createMaster('directoryTypes', { code: 'ngo', name: 'NGOs', description: '' } as never)
    await repository.createMaster('directoryTypes', { code: 'govt', name: 'Govt again', description: '' } as never)
    expect(range()).toMatchObject({ rangeStart: 26001, rangeEnd: 31000 })
    expect(getFullSnapshot().directoryIdRanges.find((r) => r.categoryKey === 'ngo')).toMatchObject({ rangeStart: 31001 })
  })

  it('keeps Amnex employee numbers unique across org and Sales, with leading zeros intact', async () => {
    const [first, second] = getFullSnapshot().orgPeople
    const saved = await repository.updateOrgPerson(first.id, { employeeNumber: 'AIPL_0123' })
    expect(saved.employeeNumber).toBe('0123')
    await expect(repository.updateOrgPerson(second.id, { employeeNumber: '0123' })).rejects.toThrow(`already belongs to ${first.name}`)
    expect((await repository.updateOrgPerson(second.id, { employeeNumber: '123' })).employeeNumber).toBe('123')
    await expect(repository.updateOrgPerson(second.id, { employeeNumber: '12a' })).rejects.toThrow('digits only')

    const sales = getFullSnapshot().salesPersons
    const stranger = sales.find((p) => p.officialEmail.toLowerCase() !== first.email.toLowerCase())!
    await expect(repository.updateSalesPerson(stranger.id, { employeeCode: '0123' })).rejects.toThrow('already belongs to')
    expect((await repository.updateSalesPerson(stranger.id, { employeeCode: '' })).employeeCode).toBe('')
  })
})

describe('v26 snapshot upgrade', () => {
  it('backfills ranges and numbers without touching existing numbers', () => {
    const upgraded = migrateSnapshot({
      employees: [{ id: 'a', vacant: false, directoryNumber: 1001 }, { id: 'b', vacant: false }, { id: 'c', vacant: true }],
      commercialCalculator: { masters: { directoryTypes: [{ code: 'internal' }, { code: 'govt' }] } },
    }, 25)!
    expect(upgraded.employees.map((e) => e.directoryNumber ?? null)).toEqual([1001, 1002, null])
    expect(upgraded.directoryIdRanges.find((r) => r.categoryKey === 'clientDepartment')?.nextValue).toBe(1003)
    expect(upgraded.directoryIdRanges.find((r) => r.categoryKey === 'govt')).toMatchObject({ rangeStart: 26001, rangeEnd: 31000 })
  })
})
