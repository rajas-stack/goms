import { SALES_TEAM, tiersOf, type SalesTeamMember } from './sales-team'
import type { SalesPerson, SalesPosting } from '@/lib/types'

export interface SalesChain {
  rm?: SalesTeamMember
  gm?: SalesTeamMember
  salesHead?: SalesTeamMember
}

/** Builds a `resolveSalesChain`-compatible roster from the LIVE sales
 *  records (`SalesPerson` + each person's current `SalesPosting`) instead of
 *  the static `SALES_TEAM` constant — so a rename, transfer, or promotion
 *  made in the Sales Team tab is reflected wherever the legacy metadata-driven
 *  ownership chain (Geo Sales → RM → GM → Sales Head) is read, not just in
 *  the tab itself. No `tiers` override is set: `defaultTiers` derives the
 *  role slot(s) straight from the live designation string, including
 *  compound ones like "Regional Manager & Head". */
export function liveSalesRoster(
  salesPersons: SalesPerson[],
  currentPostings: Record<string, SalesPosting>,
): SalesTeamMember[] {
  const emailById = new Map(salesPersons.map((p) => [p.id, p.officialEmail]))
  return salesPersons.map((p) => {
    const posting = currentPostings[p.id]
    return {
      name: p.name,
      email: p.officialEmail,
      designation: posting?.designation ?? '',
      reportsTo: posting?.managerId ? emailById.get(posting.managerId) : undefined,
    }
  })
}

/** Walks a Geo Sales person's `reportsTo` chain upward, filling RM/GM/Sales
 *  Head from whichever ancestors' tiers cover those roles. Stops once every
 *  tier is filled or the chain runs out (unset `reportsTo`, a dangling
 *  email, or a cycle). Unresolved tiers stay `undefined` — never guessed.
 *  `roster` defaults to the static `SALES_TEAM` but is swappable so a later
 *  phase can source the same shape from GOMS `Employee` records without
 *  changing this function or any of its callers. */
export function resolveSalesChain(geoSalesEmail: string, roster: SalesTeamMember[] = SALES_TEAM): SalesChain {
  const byEmail = new Map(roster.map((m) => [m.email, m]))
  const chain: SalesChain = {}
  let current = byEmail.get(geoSalesEmail)
  const seen = new Set<string>()

  while (current && current.reportsTo && !seen.has(current.email)) {
    seen.add(current.email)
    const next = byEmail.get(current.reportsTo)
    if (!next) break
    for (const tier of tiersOf(next)) {
      if (!chain[tier]) chain[tier] = next
    }
    current = next
  }
  return chain
}
