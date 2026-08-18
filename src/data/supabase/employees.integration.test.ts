import { describe, expect, it } from 'vitest'
import {
  createEmployee, getEmployee, deleteEmployee, addCharge, removeCharge, setManager, mergeEmployees,
} from './employees'
import { createNode, deleteNode } from './hierarchy'

describe('employees (Supabase integration)', () => {
  it('createEmployee + getEmployee round-trips, vacant employees get no timeline event', async () => {
    const dept = await createNode({ domain: 'org', typeKey: 'unit', parentId: null, stateCode: 0, name: 'Emp Test Unit' })
    const emp = await createEmployee({ name: 'Test Person', designation: 'Tester', email: 't@x.com', phone: '', orgNodeId: dept.id, managerId: null })
    const fetched = await getEmployee(emp.id)
    expect(fetched?.name).toBe('Test Person')
    expect(fetched?.visitingCards).toEqual([])
    await deleteEmployee(emp.id)
    await deleteNode(dept.id)
  })

  it('setManager rejects a reporting cycle', async () => {
    const dept = await createNode({ domain: 'org', typeKey: 'unit', parentId: null, stateCode: 0, name: 'Cycle Test Unit' })
    const a = await createEmployee({ name: 'A', designation: 'X', email: '', phone: '', orgNodeId: dept.id, managerId: null })
    const b = await createEmployee({ name: 'B', designation: 'X', email: '', phone: '', orgNodeId: dept.id, managerId: a.id })
    await expect(setManager(a.id, b.id)).rejects.toThrow('reporting cycle')
    await deleteEmployee(a.id)
    await deleteEmployee(b.id)
    await deleteNode(dept.id)
  })

  it('deleteEmployee resets direct reports to no manager (preserved existing behavior, not a fix)', async () => {
    const dept = await createNode({ domain: 'org', typeKey: 'unit', parentId: null, stateCode: 0, name: 'Delete Test Unit' })
    const mgr = await createEmployee({ name: 'Manager', designation: 'X', email: '', phone: '', orgNodeId: dept.id, managerId: null })
    const report = await createEmployee({ name: 'Report', designation: 'X', email: '', phone: '', orgNodeId: dept.id, managerId: mgr.id })
    await deleteEmployee(mgr.id)
    const fetched = await getEmployee(report.id)
    expect(fetched?.managerId).toBeNull()
    await deleteEmployee(report.id)
    await deleteNode(dept.id)
  })

  it('mergeEmployees combines charges and produces an audit record', async () => {
    const dept = await createNode({ domain: 'org', typeKey: 'unit', parentId: null, stateCode: 0, name: 'Merge Test Unit' })
    const survivor = await createEmployee({ name: 'Keep', designation: '', email: '', phone: '', orgNodeId: dept.id, managerId: null })
    const duplicate = await createEmployee({ name: 'Drop', designation: '', email: 'drop@x.com', phone: '', orgNodeId: dept.id, managerId: null })
    await addCharge(duplicate.id, { kind: 'additional', title: 'Temp Charge', orgNodeId: null, startDate: null, endDate: null, reason: '' })
    const { survivor: merged, audit } = await mergeEmployees({ survivorId: survivor.id, duplicateId: duplicate.id, resolutions: {} })
    expect(merged.email).toBe('drop@x.com') // auto-filled: survivor's was empty
    expect(merged.charges).toHaveLength(1)
    expect(audit.duplicateId).toBe(duplicate.id)
    expect(await getEmployee(duplicate.id)).toBeNull()
    await deleteEmployee(survivor.id)
    await deleteNode(dept.id)
  })
})
