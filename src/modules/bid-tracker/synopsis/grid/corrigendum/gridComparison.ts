import { corrigendumCode, parseGridFieldKey, type BidSynopsisSection, type SynopsisGrid } from '@goms/domain'
import { diffText, type DiffSegment } from '../../../corrigenda/textDiff'
import type { ClauseHistory, ClauseVersion } from '../../../corrigenda/tenderPosition'

/** Read-only "after corrigendum" columns derived for a synopsis grid. Pure and
 *  never written back into the grid: the grid keeps the original tender text,
 *  this model only describes what the latest effective corrigendum says. */

export type AfterCellStatus = 'changed' | 'added' | 'deleted'

export interface AfterCell {
  key: string
  history: ClauseHistory
  status: AfterCellStatus
  /** The current effective (post-corrigendum) text. */
  text: string
  /** Render-ready text with only the changed words marked. */
  segments: DiffSegment[]
  /** The version currently in effect (latest non-rejected). */
  source: ClauseVersion
  /** "C2" — the corrigendum the effective text comes from. */
  code: string
}

export interface AfterColumn {
  columnId: string
  /** "Criteria · After C2" — the latest corrigendum that changed this column. */
  header: string
  cells: Record<string, AfterCell>
}

export interface GridComparison {
  /** Keyed by the source column id; only columns with at least one effective change. */
  columns: Record<string, AfterColumn>
  /** Rows a corrigendum added (classification Added), with the C-code that added them. */
  newRows: Record<string, string>
  /** Changes linked to this section whose row or column is no longer in the grid. */
  orphans: ClauseHistory[]
  /** Number of cells with an effective change. */
  count: number
}

export const EMPTY_COMPARISON: GridComparison = { columns: {}, newRows: {}, orphans: [], count: 0 }

function cellStatus(source: ClauseVersion, original: string, current: string): AfterCellStatus {
  if (source.classification === 'deleted' || (!current.trim() && original.trim())) return 'deleted'
  if (source.classification === 'added' || (!original.trim() && current.trim())) return 'added'
  return 'changed'
}

function segmentsFor(status: AfterCellStatus, original: string, current: string): DiffSegment[] {
  if (status === 'deleted') return [{ type: 'removed', text: original }]
  if (status === 'added') return [{ type: 'added', text: current }]
  return diffText(original, current).modified
}

/** The after-cell for one clause history, or null when the cell is effectively unchanged
 *  (every version rejected, or the effective text equals the original). */
export function afterCellFor(history: ClauseHistory): AfterCell | null {
  const source = history.current.source
  if (!source) return null
  const original = history.original, current = history.current.value
  if (current === original && source.classification !== 'deleted' && source.classification !== 'added') return null
  const status = cellStatus(source, original, current)
  return {
    key: history.key, history, status, text: current, segments: segmentsFor(status, original, current),
    source, code: corrigendumCode(source.corrigendumNumber),
  }
}

/** Builds the after-columns for one section's grid from the bid's clause histories. */
export function buildGridComparison(grid: SynopsisGrid, section: BidSynopsisSection, histories: readonly ClauseHistory[]): GridComparison {
  const columnIds = new Set(grid.columns.map((c) => c.id))
  const rowIds = new Set(grid.rows.map((r) => r.id))
  const names = new Map(grid.columns.map((c) => [c.id, c.name]))
  const cells = new Map<string, Record<string, AfterCell>>()
  const latest = new Map<string, number>()
  const newRows: Record<string, string> = {}
  const orphans: ClauseHistory[] = []
  let count = 0

  for (const history of histories) {
    const ref = parseGridFieldKey(history.key)
    if (!ref || ref.section !== section) continue
    if (!rowIds.has(ref.rowId) || !columnIds.has(ref.columnId)) { orphans.push(history); continue }
    const cell = afterCellFor(history)
    if (!cell) continue
    cells.set(ref.columnId, { ...(cells.get(ref.columnId) ?? {}), [ref.rowId]: cell })
    latest.set(ref.columnId, Math.max(latest.get(ref.columnId) ?? 0, cell.source.corrigendumNumber))
    if (cell.status === 'added' && !newRows[ref.rowId]) newRows[ref.rowId] = cell.code
    count += 1
  }

  const columns = Object.fromEntries([...cells.entries()].map(([columnId, byRow]): [string, AfterColumn] => [columnId, {
    columnId, cells: byRow, header: `${names.get(columnId) ?? 'Column'} · After ${corrigendumCode(latest.get(columnId) ?? 1)}`,
  }]))
  return { columns, newRows, orphans, count }
}
