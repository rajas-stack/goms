import { describe, expect, it } from 'vitest'
import { buildSalesOrgTree } from './salesHierarchyTree'
import type { SalesPerson, SalesPosting } from '@/lib/types'

function person(id: string, name: string): SalesPerson {
  return {
    id, employeeCode: id, name, officialEmail: `${id}@amnex.com`, personalEmail: '',
    mobile: '', altMobile: '', joinedOn: null, leftOn: null, status: 'active',
    notes: '', metadata: {}, createdAt: '', createdBy: null,
  }
}
function posting(personId: string, managerId: string | null): SalesPosting {
  return {
    id: `post-${personId}`, salesPersonId: personId, designation: 'Rep', tierKey: 'accountManager',
    managerId, gmOverrideId: null, office: '', startDate: '2024-01-01', endDate: null,
    changeType: 'initial', reason: '', createdAt: '', createdBy: null,
  }
}

describe('buildSalesOrgTree', () => {
  it('groups people under their managerId and sorts children/roots by name', () => {
    const a = person('a', 'Alice')
    const b = person('b', 'Bob')
    const c = person('c', 'Carol')
    const people = [a, b, c]
    const postings = { b: posting('b', 'a'), c: posting('c', 'a'), a: posting('a', null) }
    const tree = buildSalesOrgTree(people, postings)
    expect(tree.roots.map((p) => p.id)).toEqual(['a'])
    expect(tree.childrenOf.get('a')?.map((p) => p.id)).toEqual(['b', 'c'])
    expect(tree.flaggedRootIds.size).toBe(0)
  })

  it('treats a missing posting/managerId as a legitimate, unflagged root', () => {
    const a = person('a', 'Alice')
    const tree = buildSalesOrgTree([a], {})
    expect(tree.roots.map((p) => p.id)).toEqual(['a'])
    expect(tree.flaggedRootIds.has('a')).toBe(false)
  })

  it('flags a managerId that does not resolve to anyone in the live roster as a root, without inventing a parent', () => {
    const a = person('a', 'Alice')
    const postings = { a: posting('a', 'ghost-id') }
    const tree = buildSalesOrgTree([a], postings)
    expect(tree.roots.map((p) => p.id)).toEqual(['a'])
    expect(tree.flaggedRootIds.has('a')).toBe(true)
  })

  it('flags a self-referencing managerId as a root rather than looping', () => {
    const a = person('a', 'Alice')
    const postings = { a: posting('a', 'a') }
    const tree = buildSalesOrgTree([a], postings)
    expect(tree.roots.map((p) => p.id)).toEqual(['a'])
    expect(tree.flaggedRootIds.has('a')).toBe(true)
  })

  it('breaks a two-person manager cycle into two flagged roots, each rendered exactly once', () => {
    const a = person('a', 'Alice')
    const b = person('b', 'Bob')
    const postings = { a: posting('a', 'b'), b: posting('b', 'a') }
    const tree = buildSalesOrgTree([a, b], postings)
    expect(tree.roots.map((p) => p.id).sort()).toEqual(['a', 'b'])
    expect(tree.flaggedRootIds.has('a')).toBe(true)
    expect(tree.flaggedRootIds.has('b')).toBe(true)
    // Neither cycle member appears as anyone's child — no duplicate rendering.
    expect([...tree.childrenOf.values()].flat()).toHaveLength(0)
  })

  it('still nests a legitimate report under a cycle member once that member is a root', () => {
    const a = person('a', 'Alice')
    const b = person('b', 'Bob')
    const d = person('d', 'Dave') // reports to Alice, who is part of the a<->b cycle
    const postings = { a: posting('a', 'b'), b: posting('b', 'a'), d: posting('d', 'a') }
    const tree = buildSalesOrgTree([a, b, d], postings)
    expect(tree.roots.map((p) => p.id).sort()).toEqual(['a', 'b'])
    expect(tree.flaggedRootIds.has('d')).toBe(false)
    expect(tree.childrenOf.get('a')?.map((p) => p.id)).toEqual(['d'])
  })
})
