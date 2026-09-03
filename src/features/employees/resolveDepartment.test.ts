import { describe, expect, it } from 'vitest'
import { resolveDepartment } from './resolveDepartment'
import type { HierNode } from '@/lib/types'

function makeNode(overrides: Partial<HierNode> & { id: string }): HierNode {
  return {
    domain: 'org', typeKey: 'department', parentId: null, stateCode: 5,
    name: overrides.id, code: null, sortOrder: 0, metadata: {}, status: 'active',
    ...overrides,
  }
}

describe('resolveDepartment', () => {
  it('returns the node itself when it is already a department', () => {
    const dept = makeNode({ id: 'dept-1', typeKey: 'department' })
    expect(resolveDepartment(dept, [dept])).toBe(dept)
  })

  it('walks up through nested branch/office/unit ancestors to find the department', () => {
    const dept = makeNode({ id: 'dept-1', typeKey: 'department', parentId: null })
    const branch = makeNode({ id: 'branch-1', typeKey: 'branch', parentId: 'dept-1' })
    const office = makeNode({ id: 'office-1', typeKey: 'office', parentId: 'branch-1' })
    const unit = makeNode({ id: 'unit-1', typeKey: 'unit', parentId: 'office-1' })
    const allNodes = [dept, branch, office, unit]

    expect(resolveDepartment(unit, allNodes)).toBe(dept)
    expect(resolveDepartment(office, allNodes)).toBe(dept)
    expect(resolveDepartment(branch, allNodes)).toBe(dept)
  })

  it('resolves to the nearest (nested) department, not the root ancestor department', () => {
    const rootDept = makeNode({ id: 'root-dept', typeKey: 'department', parentId: null })
    const nestedDept = makeNode({ id: 'nested-dept', typeKey: 'department', parentId: 'root-dept' })
    const branch = makeNode({ id: 'branch-1', typeKey: 'branch', parentId: 'nested-dept' })
    const allNodes = [rootDept, nestedDept, branch]

    expect(resolveDepartment(branch, allNodes)).toBe(nestedDept)
    expect(resolveDepartment(nestedDept, allNodes)).toBe(nestedDept)
  })

  it('returns null when no ancestor is a department', () => {
    const state = makeNode({ id: 'state-1', typeKey: 'state', parentId: null })
    const office = makeNode({ id: 'office-1', typeKey: 'office', parentId: 'state-1' })
    expect(resolveDepartment(office, [state, office])).toBeNull()
  })

  it('returns null rather than looping forever on a cyclic parentId chain', () => {
    const a = makeNode({ id: 'a', typeKey: 'office', parentId: 'b' })
    const b = makeNode({ id: 'b', typeKey: 'office', parentId: 'a' })
    expect(resolveDepartment(a, [a, b])).toBeNull()
  })
})
