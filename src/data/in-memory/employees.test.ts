import { describe, it, expect, beforeEach } from 'vitest'
import { repository, resetLocalData } from '@/data/repository'

// 2026-08-26 backend hardening pass. `deleteEmployee` used to look up the
// removed employee (for its manager-fallback) AFTER already filtering it out
// of `this.data.employees` — so the lookup always returned undefined, and
// every direct report's managerId was unconditionally set to null instead of
// falling back to the removed person's own manager, contradicting the
// function's own "orphaned reports fall back to the removed person's
// manager" comment. Mirrors apps/api/src/routers/employees.ts's `delete`,
// which reads manager_id before deleting for exactly this reason.
describe('InMemoryRepository.deleteEmployee', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('reassigns direct reports to the removed manager\'s own manager, not null', async () => {
    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })
    const grandparent = await repository.createEmployee({
      name: 'GP', designation: 'VP', email: '', phone: '', orgNodeId: dept.id, managerId: null,
    })
    const middleManager = await repository.createEmployee({
      name: 'Middle Manager', designation: 'Manager', email: '', phone: '', orgNodeId: dept.id, managerId: grandparent.id,
    })
    const report = await repository.createEmployee({
      name: 'Report', designation: 'Officer', email: '', phone: '', orgNodeId: dept.id, managerId: middleManager.id,
    })

    await repository.deleteEmployee(middleManager.id)

    const updatedReport = await repository.getEmployee(report.id)
    expect(updatedReport?.managerId).toBe(grandparent.id)
  })

  it('clears a dangling deptHead pointer on a hierarchy node when the department head is deleted', async () => {
    const dept = await repository.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept With Head' })
    const head = await repository.createEmployee({
      name: 'Head', designation: 'Head', email: '', phone: '', orgNodeId: dept.id, managerId: null,
    })
    await repository.updateNode(dept.id, { metadata: { deptHead: head.id } })
    expect((await repository.getNode(dept.id))?.metadata?.deptHead).toBe(head.id)

    await repository.deleteEmployee(head.id)

    expect((await repository.getNode(dept.id))?.metadata?.deptHead).toBeUndefined()
  })
})
