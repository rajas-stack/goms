import { atomsForPatch } from '@goms/domain'
import { DenyCall } from '../denial.js'
import { rowForBid, rowForOpportunity } from '../rows.js'
import type { Requirement } from './types.js'

/** patch → atoms, or refuse the whole call when a key has no atom (fail closed; zod would silently strip it). */
export function patchAtoms(patch: unknown, resolve: (key: string) => string | null | undefined): string[] {
  const atoms = atomsForPatch(patch, resolve)
  if (atoms === null) throw new DenyCall('That change includes a field that cannot be edited.')
  return atoms
}

type RowAction = 'update' | 'delete'

/** A write on one bid's row, authorised in the module of the sheet the bid lives on, with that row's scope facts. */
export const bidRow = (action: RowAction, pick: (raw: any) => unknown, atoms?: (raw: any) => string[]): Requirement =>
  async (raw) => {
    const row = await rowForBid(pick(raw))
    return { module: row?.module ?? 'opp.bidTracker', action, atoms: atoms?.(raw), row: row?.facts }
  }

/** Same, addressed by opportunity id (a bid-less opportunity is authorised as Bid Tracker). */
export const oppRow = (action: RowAction, pick: (raw: any) => unknown, atoms?: (raw: any) => string[]): Requirement =>
  async (raw) => {
    const row = await rowForOpportunity(pick(raw))
    return { module: row?.module ?? 'opp.bidTracker', action, atoms: atoms?.(raw), row: row?.facts }
  }
