/** Atoms only a `W` grant can hold; they are never placed in a partial set (spec §6.2). */
export const W_ONLY_ATOMS: readonly string[] = [
  'bid.stage', 'bid.verify', 'bid.archive', 'bid.move', 'opp.tenderId', 'opp.dates', 'opp.stage',
]

/** Atoms `W` does NOT imply: they are granted only by an explicit partial set, or by nobody.
 *  - sku.* / master.taxClasses / master.currencies: Finance-controlled commercial fields (spec §6.3).
 *  - boq.approve: BOQ approve/reject is CXO-only (spec §14.7).
 *  - ownership.solutionLead: Solution Lead is read-only for every role in v1 — no set contains it. */
export const EXCLUSIVE_ATOMS: ReadonlySet<string> = new Set([
  'sku.costs', 'sku.floor', 'sku.tax', 'master.taxClasses', 'master.currencies', 'boq.approve', 'ownership.solutionLead',
])
