import { allocateOpportunityCode, opportunityCodeParts, type OpportunityCodeInput } from '@goms/domain'
import type { HierNode, Opportunity } from '@/lib/types'

/** The fields of an opportunity (and its department node) the Opportunity ID
 *  is built from — shared by the in-memory store's create path and the v20
 *  backfill migration, so both produce exactly the same codes. */
export function opportunityCodeInputFor(
  opp: Pick<Opportunity, 'submissionDate' | 'createdAt' | 'vertical' | 'stateCode' | 'departmentId' | 'opportunityType' | 'component'>,
  nodes: readonly Pick<HierNode, 'id' | 'name' | 'metadata'>[],
): OpportunityCodeInput {
  const dept = opp.departmentId ? nodes.find((n) => n.id === opp.departmentId) : undefined
  return {
    submissionDate: opp.submissionDate, createdAt: opp.createdAt, vertical: opp.vertical,
    stateCode: opp.stateCode, opportunityType: opp.opportunityType, component: opp.component,
    department: dept ? { shortName: dept.metadata?.shortName, name: dept.name } : null,
  }
}

/** Gives every opportunity WITHOUT a code one, in creation order (createdAt,
 *  then id), from the per-fiscal-year counters. Opportunities that already
 *  have a code are never touched (the code is locked once assigned). Returns
 *  new arrays/maps; the inputs are not modified. */
export function assignMissingOpportunityCodes<T extends Pick<Opportunity, 'id' | 'submissionDate' | 'createdAt' | 'vertical' | 'stateCode' | 'departmentId' | 'opportunityType' | 'component'> & { opportunityCode?: string | null }>(
  opportunities: readonly T[],
  nodes: readonly Pick<HierNode, 'id' | 'name' | 'metadata'>[],
  sequences: Readonly<Record<string, number>>,
  today: Date = new Date(),
): { opportunities: T[]; sequences: Record<string, number> } {
  const codes = opportunities.map((o) => o.opportunityCode || '')
  const order = opportunities
    .map((o, index) => ({ o, index }))
    .filter(({ o }) => !o.opportunityCode)
    .sort((a, b) => (a.o.createdAt ?? '').localeCompare(b.o.createdAt ?? '') || a.o.id.localeCompare(b.o.id))
  let next = { ...sequences }
  for (const { o, index } of order) {
    const allocated = allocateOpportunityCode(opportunityCodeParts(opportunityCodeInputFor(o, nodes), today), next, codes)
    codes[index] = allocated.code
    next = allocated.sequences
  }
  return { opportunities: opportunities.map((o, i) => (o.opportunityCode ? o : { ...o, opportunityCode: codes[i] })), sequences: next }
}
