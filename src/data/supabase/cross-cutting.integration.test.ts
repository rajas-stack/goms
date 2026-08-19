import { describe, expect, it } from 'vitest'
import { createEmployee, deleteEmployee } from './employees'
import { createNode, deleteNode } from './hierarchy'
import { search, relatedRecords, relationshipAnalytics } from './cross-cutting'

describe('cross-cutting (Supabase integration)', () => {
  it('search finds a seeded employee by name and relatedRecords resolves its department', async () => {
    const uniqueName = `Zzz Crosscutting Test Person ${Date.now()}`
    const dept = await createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 0, name: 'Crosscutting Test Department' })
    const emp = await createEmployee({
      name: uniqueName, designation: 'Test Designation', email: '', phone: '', orgNodeId: dept.id, managerId: null,
    })

    const results = await search(uniqueName)
    const hit = results.find((r) => r.kind === 'employee' && r.id === emp.id)
    expect(hit).toBeTruthy()

    const related = await relatedRecords(hit!)
    expect(related.some((r) => r.category === 'department' && r.id === dept.id)).toBe(true)

    await deleteEmployee(emp.id)
    await deleteNode(dept.id)
  })

  it('search recognises the "vacant" intent keyword', async () => {
    const dept = await createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 0, name: 'Vacant Search Test Department' })
    const vacantEmp = await createEmployee({
      name: 'Ignored', designation: `Vacant Test Designation ${Date.now()}`, email: '', phone: '',
      orgNodeId: dept.id, managerId: null, vacant: true,
    })

    const results = await search(`vacant ${vacantEmp.designation.toLowerCase()}`)
    expect(results.some((r) => r.id === vacantEmp.id)).toBe(true)

    await deleteEmployee(vacantEmp.id)
    await deleteNode(dept.id)
  })

  it('relationshipAnalytics totals are internally consistent', async () => {
    const analytics = await relationshipAnalytics()
    expect(analytics.connected + analytics.notConnected).toBe(analytics.total)
    expect(analytics.total).toBeGreaterThanOrEqual(0)
    expect(analytics.vacant).toBeGreaterThanOrEqual(0)
  })

  it('search returns nothing for a blank query', async () => {
    expect(await search('   ')).toEqual([])
  })
})
