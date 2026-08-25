// Integration test — needs a running apps/api instance (VITE_API_BASE_URL)
// backed by a real Postgres. Excluded from the default `npm test` run (see
// vite.config.ts); run manually against a local `npm --workspace apps/api
// run dev` (or, later, the deployed dev Cloud Run URL).
import { describe, it, expect } from 'vitest'
import { RemoteRepository } from './repository'

describe.skipIf(!import.meta.env.VITE_API_BASE_URL)('RemoteRepository (integration)', () => {
  const repo = new RemoteRepository()

  it('round-trips a customer through create/get/update/delete', async () => {
    const created = await repo.createCustomer!({ name: 'Integration Test Co' })
    expect(created.name).toBe('Integration Test Co')

    const fetched = await repo.getCustomer!(created.id)
    expect(fetched?.id).toBe(created.id)

    const updated = await repo.updateCustomer!(created.id, { name: 'Renamed Co' })
    expect(updated.name).toBe('Renamed Co')

    await repo.deleteCustomer!(created.id)
    const afterDelete = await repo.getCustomer!(created.id)
    expect(afterDelete).toBeNull()
  })

  it('round-trips a hierarchy node through create/getNode/listChildren/deleteNode', async () => {
    const dept = await repo.createNode!({
      domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Integration Test Dept',
    })
    expect(dept.name).toBe('Integration Test Dept')

    const branch = await repo.createNode!({
      domain: 'org', typeKey: 'branch', parentId: dept.id, stateCode: 27, name: 'Integration Test Branch',
    })
    const children = await repo.listChildren!(dept.id)
    expect(children.map((c) => c.id)).toContain(branch.id)

    await repo.deleteNode!(dept.id)
    expect(await repo.getNode!(dept.id)).toBeUndefined()
    expect(await repo.getNode!(branch.id)).toBeUndefined()
  })

  it('round-trips an employee through create/get/transfer/timeline/delete', async () => {
    const dept = await repo.createNode!({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Integration Test Dept' })
    const officeA = await repo.createNode!({ domain: 'org', typeKey: 'office', parentId: dept.id, stateCode: 27, name: 'Office A' })
    const officeB = await repo.createNode!({ domain: 'org', typeKey: 'office', parentId: dept.id, stateCode: 27, name: 'Office B' })

    const emp = await repo.createEmployee!({
      name: 'Integration Employee', designation: 'Officer', email: 'test@example.com', phone: '9999999999',
      orgNodeId: officeA.id, managerId: null,
    })
    expect(emp.name).toBe('Integration Employee')

    const transfer = await repo.transferEmployee!({
      employeeId: emp.id, toOrgNodeId: officeB.id, toDesignation: 'Senior Officer',
      effectiveDate: '2026-02-01', reason: 'Promotion',
    })
    expect(transfer.toOrgNodeId).toBe(officeB.id)

    const timeline = await repo.listTimeline!(emp.id)
    expect(timeline.some((t) => t.type === 'transferred')).toBe(true)

    await repo.deleteEmployee!(emp.id)
    expect(await repo.getEmployee!(emp.id)).toBeNull()
    await repo.deleteNode!(dept.id)
  })
})
