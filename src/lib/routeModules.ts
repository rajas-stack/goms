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
