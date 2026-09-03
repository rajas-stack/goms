import { describe, it, expect, beforeEach } from 'vitest'
import { repository, resetLocalData } from '@/data/repository'

// Department → Department nesting: a department can contain another
// department (e.g. "Industry Bodies" nested under "Electronics & IT"),
// mirroring apps/api/src/routers/hierarchy.ts's equivalent tests.
describe('InMemoryRepository hierarchy', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('creates a department nested under another department', async () => {
    const parent = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Electronics & IT' })
    const child = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: parent.id, stateCode: 27, name: 'Industry Bodies' })
    expect(child.parentId).toBe(parent.id)
    const crumb = await repository.breadcrumb(child.id)
    expect(crumb.map((n) => n.name)).toEqual(['Electronics & IT', 'Industry Bodies'])
  })

  it('listOrgRoots excludes a department nested under another department', async () => {
    // A dedicated, otherwise-unused stateCode — the in-memory store is
    // seeded with real departments, so exact-equality against `listOrgRoots`
    // would be brittle against seed data changes.
    const parent = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 501, name: 'Electronics & IT' })
    const nested = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: parent.id, stateCode: 501, name: 'Industry Bodies' })
    const roots = await repository.listOrgRoots(501)
    expect(roots.map((r) => r.id)).toContain(parent.id)
    expect(roots.map((r) => r.id)).not.toContain(nested.id)
  })

  it('moveTargets allows moving a department under another department', async () => {
    const deptA = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Electronics & IT' })
    const deptB = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Industry Bodies' })
    const targets = await repository.moveTargets(deptB.id)
    expect(targets.map((t) => t.id)).toContain(deptA.id)
  })

  it('rejects createNode when the child type is not allowed under the parent type', async () => {
    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    await expect(
      repository.createNode({ domain: 'org', typeKey: 'office', parentId: dept.id, stateCode: 27, name: 'Bad Office' }),
    ).rejects.toThrow()
  })

  it('rejects moveNode when the target parent does not allow the moved node\'s type', async () => {
    const deptA = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept A' })
    const deptB = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept B' })
    const branch = await repository.createNode({ domain: 'org', typeKey: 'branch', parentId: deptA.id, stateCode: 27, name: 'Branch' })
    const office = await repository.createNode({ domain: 'org', typeKey: 'office', parentId: branch.id, stateCode: 27, name: 'Office' })
    await expect(repository.moveNode(office.id, deptB.id)).rejects.toThrow()
  })

  it('existing valid hierarchy relationships still work (department -> branch -> office -> unit)', async () => {
    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    const branch = await repository.createNode({ domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Branch' })
    const office = await repository.createNode({ domain: 'org', typeKey: 'office', parentId: branch.id, stateCode: 27, name: 'Office' })
    const unit = await repository.createNode({ domain: 'org', typeKey: 'unit', parentId: office.id, stateCode: 27, name: 'Unit' })
    expect(unit.parentId).toBe(office.id)
  })
})
