import { DEFAULT_OWNED_SHEET, isOwnedSheet, type OwnedSheet } from '../bids.js'
import type { PolicyModuleKey } from './policy.js'

export type RowModule = Extract<PolicyModuleKey, 'opp.bidTracker' | 'opp.pipeline' | 'opp.campaign'>

/** Which RBAC module governs a bid's row, by the sheet it lives on. One table for the server and the grid. */
export const SHEET_MODULE: Record<OwnedSheet, RowModule> = {
  bidTracker: 'opp.bidTracker',
  'pipeline-funnel': 'opp.pipeline', 'pipeline-backup': 'opp.pipeline', 'pipeline-commits': 'opp.pipeline',
  campaign: 'opp.campaign',
}
/** Unknown or absent sheet (a bid-less opportunity) is authorised as Bid Tracker. */
export const sheetModule = (sheet: unknown): RowModule => SHEET_MODULE[isOwnedSheet(sheet) ? sheet : DEFAULT_OWNED_SHEET]
