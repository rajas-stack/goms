import { BID_SYNOPSIS_SECTIONS, type BidSynopsisSection } from './bidSynopsis.js'
import type { CorrigendumAffectedModule } from './corrigenda.js'

/** Links a corrigendum clause change to one cell of a synopsis grid:
 *  `grid:<section>:<rowId>:<columnId>`. Row and column ids are the grid's
 *  stable ids (see synopsisGrid.ts), so the link survives reordering,
 *  renaming and sorting. */

export interface GridCellRef { section: BidSynopsisSection; rowId: string; columnId: string }

const GRID_KEY_PREFIX = 'grid'
const GRID_ID = /^[A-Za-z0-9_-]{1,40}$/

/** The affected-module each synopsis section records its changes under. */
export const SECTION_CORRIGENDUM_MODULE: Record<BidSynopsisSection, CorrigendumAffectedModule> = {
  general: 'other', scope: 'sow', pq: 'pq', tq: 'tq', manpower: 'manpower', milestone: 'milestones',
  payment: 'payment_terms', boq: 'boq', queries: 'other', competition: 'other',
}

export function buildGridFieldKey(ref: GridCellRef): string {
  if (!(BID_SYNOPSIS_SECTIONS as readonly string[]).includes(ref.section)) throw new Error(`Unknown synopsis section: ${ref.section}`)
  if (!GRID_ID.test(ref.rowId) || !GRID_ID.test(ref.columnId)) throw new Error('Invalid grid row or column id.')
  return `${GRID_KEY_PREFIX}:${ref.section}:${ref.rowId}:${ref.columnId}`
}

/** The cell a field key points at, or null when the key is not a grid key. */
export function parseGridFieldKey(key: string): GridCellRef | null {
  const parts = key.split(':')
  if (parts.length !== 4 || parts[0] !== GRID_KEY_PREFIX) return null
  const [, section, rowId, columnId] = parts
  if (!(BID_SYNOPSIS_SECTIONS as readonly string[]).includes(section)) return null
  if (!GRID_ID.test(rowId) || !GRID_ID.test(columnId)) return null
  return { section: section as BidSynopsisSection, rowId, columnId }
}

export const isGridFieldKey = (key: string): boolean => parseGridFieldKey(key) !== null
