import type { PolicyModuleKey } from '@goms/domain'

/** Which modules open which part of the app (any one at Read or above). Shared by the router and the navigation, so a
 *  hidden entry and a refused route can never disagree. */
export const ROW_MODULES: PolicyModuleKey[] = ['opp.bidTracker', 'opp.pipeline', 'opp.campaign']

export const NAV_MODULES = {
  map: ['am.geography'],
  directory: ['am.contacts', 'am.departments'],
  insights: ['an.operational'],
  meetings: ['am.meetings'],
  sales: ['team.sales'],
  teams: ['team.org', 'team.sales'],
  commercial: ['com.boqs', 'com.skus', 'com.masters'],
  opportunity: ROW_MODULES,
  adminAccess: ['admin.access'],
  /** Account Mapping's rail entry opens if any of its sections can be opened. */
  accountMapping: ['am.geography', 'am.contacts', 'am.departments', 'am.meetings', 'an.operational'],
} satisfies Record<string, PolicyModuleKey[]>

/** The Opportunity module's tabs follow their sheet (Master is any sheet; Dashboard is Operational analytics). */
export const OPPORTUNITY_TAB_MODULES: Record<string, PolicyModuleKey[]> = {
  'bid-tracker': ['opp.bidTracker'], pipeline: ['opp.pipeline'], campaign: ['opp.campaign'], master: ROW_MODULES, dashboard: ['an.operational'],
}

/** hierarchy_nodes.domain → the module that governs the node (mirrors the server's registry). */
export function moduleForDomain(domain: string | undefined): PolicyModuleKey {
  return domain === 'geo' ? 'am.geography' : domain === 'sales' ? 'team.sales' : 'am.departments'
}

/** Scope facts for a screen about one Sales Team person's row: "own" for exactly that person. */
export function salesPersonRow(personId: string | null | undefined) {
  return { salesOwnerIds: personId ? [personId] : [], createdBy: null, assigned: { presales: null, legal: null, bid: null } } as const
}
