import { describe, it, expect } from 'vitest'
import { topologicalOrder } from './dependencyGraph.js'

describe('topologicalOrder', () => {
  it('orders employees after organizationHierarchy', () => {
    const order = topologicalOrder(['employees', 'organizationHierarchy'])
    expect(order.indexOf('organizationHierarchy')).toBeLessThan(order.indexOf('employees'))
  })

  it('orders bom after skus after its masters', () => {
    const order = topologicalOrder(['bom', 'skus', 'commercialMastersCatalog', 'commercialMastersFlat', 'currencies', 'taxClasses'])
    expect(order.indexOf('commercialMastersFlat')).toBeLessThan(order.indexOf('skus'))
    expect(order.indexOf('commercialMastersCatalog')).toBeLessThan(order.indexOf('skus'))
    expect(order.indexOf('currencies')).toBeLessThan(order.indexOf('skus'))
    expect(order.indexOf('taxClasses')).toBeLessThan(order.indexOf('skus'))
    expect(order.indexOf('skus')).toBeLessThan(order.indexOf('bom'))
  })

  it('ignores a dependency on a domain absent from this session (already-satisfied elsewhere)', () => {
    // employees present without organizationHierarchy: not an error here —
    // the orchestrator (Task 7) is responsible for treating a domain's
    // *live-DB* state as satisfying an absent dependency; the graph itself
    // only orders what's present.
    expect(() => topologicalOrder(['employees'])).not.toThrow()
    expect(topologicalOrder(['employees'])).toEqual(['employees'])
  })

  it('is stable: two independent domains keep their input order', () => {
    expect(topologicalOrder(['taxClasses', 'currencies'])).toEqual(['taxClasses', 'currencies'])
  })
})
