import { buildGridFieldKey, SECTION_CORRIGENDUM_MODULE, type BidSynopsisSection, type SynopsisGrid } from '@goms/domain'
import { emptyClauseDraft, type ClauseDraft } from '../../../corrigenda/ClauseChangeEditor'
import type { ClauseHistory } from '../../../corrigenda/tenderPosition'
import { SECTION_LABELS } from '../../documents'
import { cellText } from '../gridModel'

const ROW_LABEL_MAX = 120
const TITLE_MAX = 300

/** A Record Corrigendum draft pre-filled from one grid cell: title from the
 *  row's first visible column + the column name, module from the section,
 *  the cell's text as the original, and the grid field key as the link. An
 *  already-tracked cell chains from its current effective text instead. */
export function clauseDraftFromCell(
  grid: SynopsisGrid, section: BidSynopsisSection, rowId: string, columnId: string, histories: readonly ClauseHistory[],
): ClauseDraft {
  const rowIndex = grid.rows.findIndex((r) => r.id === rowId)
  const row = grid.rows[rowIndex]
  const column = grid.columns.find((c) => c.id === columnId)
  if (!row || !column) throw new Error('That cell is no longer in the grid.')
  const key = buildGridFieldKey({ section, rowId, columnId })
  const first = grid.columns.find((c) => !c.hidden) ?? grid.columns[0]
  const rowText = cellText(first, row.cells[first.id]).replace(/\s+/g, ' ').trim().slice(0, ROW_LABEL_MAX)
  const rowLabel = rowText || `Row ${rowIndex + 1}`
  const linkLabel = `${SECTION_LABELS[section]} › ${rowLabel} › ${column.name}`
  const tracked = histories.find((h) => h.key === key)
  if (tracked) {
    return { ...emptyClauseDraft(), existingKey: key, fieldKey: key, linkLabel, title: tracked.title, module: tracked.module, original: tracked.current.value }
  }
  return {
    ...emptyClauseDraft(), fieldKey: key, linkLabel,
    title: `${rowLabel} — ${column.name}`.slice(0, TITLE_MAX),
    module: SECTION_CORRIGENDUM_MODULE[section],
    original: cellText(column, row.cells[column.id]),
  }
}
