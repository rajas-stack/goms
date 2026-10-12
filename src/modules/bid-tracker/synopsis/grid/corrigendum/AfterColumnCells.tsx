import type { CSSProperties, KeyboardEvent } from 'react'
import type { GridFieldType } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { DiffText } from '../../../corrigenda/DiffText'
import type { DiffSegment } from '../../../corrigenda/textDiff'
import { formatNumeric, isNumericType } from '../GridCell'
import type { AfterCell, AfterColumn, GridComparison } from './gridComparison'

/** What the grid needs to draw the derived corrigendum columns. */
export interface GridCorrigendumOverlay {
  comparison: GridComparison
  /** Opens the history of one changed cell. */
  onOpen: (cell: AfterCell) => void
  /** Starts "Record corrigendum change…" for a cell (absent without permission). */
  onRecord?: (rowId: string, columnId: string) => void
}

export const AFTER_COLUMN_MIN_WIDTH = 220
export const afterColumnWidth = (sourceWidth: number): number => Math.max(AFTER_COLUMN_MIN_WIDTH, sourceWidth)

// Keys pressed on the after-cell's own buttons are theirs, not the grid's
// (Enter must open the history, not start editing the selected cell).
const keepKeys = (event: KeyboardEvent) => event.stopPropagation()

const STATUS_LABEL: Record<AfterCell['status'], string> = { changed: 'Changed', added: 'Added', deleted: 'Deleted' }

export function AfterHeaderCell({ column, style }: { column: AfterColumn; style: CSSProperties }) {
  return (
    <th scope="col" role="columnheader" aria-readonly="true" data-after-column={column.columnId} style={style}
      className="sticky top-0 z-[3] border-b border-r border-line bg-blue-50 px-2 text-left text-[12px] font-semibold text-blue-700">
      <div className="flex items-center gap-1.5">
        <Icon name="GitBranch" size={13} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={`${column.header} (read-only, from corrigenda)`}>{column.header}</span>
      </div>
    </th>
  )
}

/** Numeric columns show the effective value formatted like the grid ("₹18,00,000.00"), wholly marked as changed. */
function displaySegments(cell: AfterCell, type: GridFieldType): DiffSegment[] {
  const n = Number(cell.text.replace(/[,₹\s%]/g, ''))
  if (!isNumericType(type) || cell.status === 'deleted' || !cell.text.trim() || !Number.isFinite(n)) return cell.segments
  return [{ type: 'added', text: formatNumeric(type, n) }]
}

interface AfterDataCellProps {
  cell: AfterCell | undefined
  /** The source column's type, for number/currency formatting. */
  type: GridFieldType
  /** "Row 3, Criteria" — for accessible names. */
  label: string
  style: CSSProperties
  onOpen: (cell: AfterCell) => void
  onRecord?: () => void
}

/** Blank when the clause is unchanged; otherwise the effective text with only
 *  the changed words marked and a C-chip naming the corrigendum it came from. */
export function AfterDataCell({ cell, type, label, style, onOpen, onRecord }: AfterDataCellProps) {
  return (
    <td role="gridcell" aria-readonly="true" data-after-cell={cell?.status ?? 'same'} style={style} onKeyDown={keepKeys}
      className={cn('group/after relative border-b border-r border-line px-2 align-middle', cell ? 'bg-blue-50' : 'bg-white')}>
      {cell ? (
        <button type="button" onClick={() => onOpen(cell)} title={`${STATUS_LABEL[cell.status]} by ${cell.code} — show history`}
          aria-label={`${label}: ${STATUS_LABEL[cell.status].toLowerCase()} by ${cell.code}. Show history`}
          className="flex w-full items-start gap-1.5 py-1 text-left focus-visible:focus-ring">
          <span className={cn('mt-0.5 shrink-0 rounded px-1 font-mono text-[10.5px] font-semibold leading-4',
            cell.status === 'deleted' ? 'bg-crimson-100 text-crimson' : cell.status === 'added' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700')}>
            {cell.code}
          </span>
          <DiffText segments={displaySegments(cell, type)} className={cn('line-clamp-2 min-w-0 text-[12.5px] leading-snug', cell.status === 'deleted' && 'line-through')} />
        </button>
      ) : onRecord ? (
        <button type="button" onClick={onRecord} aria-label={`Record corrigendum change for ${label}`} title="Record corrigendum change…"
          className="absolute inset-0 flex items-center justify-center gap-1 text-[11px] text-muted opacity-0 hover:text-ink focus-visible:opacity-100 group-hover/after:opacity-100">
          <Icon name="Plus" size={12} /> Record change
        </button>
      ) : null}
    </td>
  )
}

/** Gutter marker for a row a corrigendum added. */
export function NewRowMarker({ code }: { code: string }) {
  return (
    <span title={`Added by ${code}`} className="rounded bg-emerald-100 px-1 text-[9px] font-semibold uppercase leading-4 text-emerald-700">
      New<span className="sr-only"> row, added by {code}</span>
    </span>
  )
}
