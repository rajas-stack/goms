import { describe, expect, it } from 'vitest'
import { listOrgRoots, listDepartments, listPostingNodes } from './departments'

describe('departments (Supabase integration)', () => {
  it('listDepartments returns every active department, state-then-name sorted', async () => {
    const depts = await listDepartments()
    expect(depts.length).toBeGreaterThan(0)
    expect(depts.every((d) => d.typeKey === 'department' && d.status === 'active')).toBe(true)
    const sorted = [...depts].sort(
      (a, b) => (a.stateCode ?? 0) - (b.stateCode ?? 0) || a.name.localeCompare(b.name),
    )
    expect(depts.map((d) => d.id)).toEqual(sorted.map((d) => d.id))
  })

  it('listOrgRoots(0) returns only the Central-government department roots', async () => {
    const roots = await listOrgRoots(0)
    expect(roots.length).toBeGreaterThan(0)
    expect(roots.every((n) => n.stateCode === 0 && n.typeKey === 'department')).toBe(true)
  })

  it('listPostingNodes(0) includes every org type, not just offices/units', async () => {
    const nodes = await listPostingNodes(0)
    const typeKeys = new Set(nodes.map((n) => n.typeKey))
    // gov-hierarchy.ts's Central group has department/branch/division/office/unit nodes.
    expect(typeKeys.has('department')).toBe(true)
    expect(typeKeys.has('branch')).toBe(true)
    expect(typeKeys.has('unit')).toBe(true)
  })
})
