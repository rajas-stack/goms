import type { ImportDomainKey } from '../types.js'

/** Which domains each key's reference-resolution depends on, read directly
 *  off each domain adapter's own FK/lookup queries (not the design spec's
 *  looser prose) — see this task's design note in the plan for the exact
 *  per-edge justification. A domain absent from this map has no in-scope
 *  cross-domain dependency. */
export const DOMAIN_DEPENDENCIES: Record<ImportDomainKey, ImportDomainKey[]> = {
  geography: [],
  organizationHierarchy: [],
  employees: ['organizationHierarchy'],
  salesRoster: [],
  commercialMastersCatalog: [],
  commercialMastersFlat: [],
  currencies: [],
  taxClasses: [],
  approvalMatrix: [],
  skus: ['commercialMastersCatalog', 'commercialMastersFlat', 'currencies', 'taxClasses'],
  bom: ['skus'],
  // A bid's own resolution reads `opportunities` directly, which is not one of
  // this map's keys, so it has no in-scope dependency. A milestone needs its
  // bid to already exist — committed earlier, or earlier in this same session.
  bids: [],
  bidMilestones: ['bids'],
}

/** Stable topological sort (Kahn's algorithm, ties broken by input order)
 *  over only the domains actually present in this session — a dependency
 *  on a domain NOT present is dropped rather than erroring, since that
 *  dependency is expected to already be satisfied by data already committed
 *  in a previous session (the orchestrator's live-DB re-validation, not
 *  this graph, is what actually enforces that). */
export function topologicalOrder(domainsPresent: ImportDomainKey[]): ImportDomainKey[] {
  const present = new Set(domainsPresent)
  const remaining = [...domainsPresent]
  const placed = new Set<ImportDomainKey>()
  const result: ImportDomainKey[] = []

  while (remaining.length > 0) {
    const nextIndex = remaining.findIndex((d) =>
      DOMAIN_DEPENDENCIES[d].every((dep) => !present.has(dep) || placed.has(dep)),
    )
    // Every edge in DOMAIN_DEPENDENCIES is acyclic by construction (verified
    // by inspection above) — this can't actually happen, but fails loudly
    // rather than looping forever if that invariant is ever broken.
    if (nextIndex === -1) throw new Error(`topologicalOrder: cyclic or unresolvable dependency among [${remaining.join(', ')}]`)
    const [domain] = remaining.splice(nextIndex, 1)
    placed.add(domain)
    result.push(domain)
  }
  return result
}
