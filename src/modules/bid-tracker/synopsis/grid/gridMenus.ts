import type { GridColumn, SynopsisGrid } from '@goms/domain'
import type { MenuEntry } from '../../components/GridContextMenu'
import {
  deleteColumn, deleteRows, duplicateRow, insertColumn, insertRow, makeColumn, moveColumn, moveRow, sortRows, updateColumn,
} from './gridModel'

interface Ctx {
  grid: SynopsisGrid
  apply: (next: SynopsisGrid) => void
  onError: (message: string) => void
}

function guard(ctx: Ctx, run: () => SynopsisGrid) {
  return () => {
    try { ctx.apply(run()) } catch (error) { ctx.onError(error instanceof Error ? error.message : 'Could not change the grid.') }
  }
}

/** Right-click on a cell or row number: row actions (Sheets "Rows" / Baserow row menu). */
export function rowMenu(ctx: Ctx, rowIds: string[], opts: { onClear: () => void; onCopy: () => void; columnId?: string; onInsertColumn?: (side: 'left' | 'right') => void }): MenuEntry[][] {
  const { grid } = ctx
  const first = grid.rows.findIndex(row => row.id === rowIds[0])
  const last = grid.rows.findIndex(row => row.id === rowIds[rowIds.length - 1])
  const many = rowIds.length > 1
  return [
    [
      { label: 'Copy', icon: 'Copy', onSelect: opts.onCopy },
      { label: 'Clear cells', icon: 'X', onSelect: opts.onClear },
    ],
    [
      { label: 'Insert row above', icon: 'ArrowUp', onSelect: guard(ctx, () => insertRow(grid, first)) },
      { label: 'Insert row below', icon: 'ArrowDown', onSelect: guard(ctx, () => insertRow(grid, last + 1)) },
      { label: 'Duplicate row', icon: 'Copy', disabled: many, onSelect: guard(ctx, () => duplicateRow(grid, rowIds[0])) },
      { label: 'Move row up', icon: 'ChevronUp', disabled: many || first <= 0, onSelect: guard(ctx, () => moveRow(grid, first, first - 1)) },
      { label: 'Move row down', icon: 'ChevronDown', disabled: many || last >= grid.rows.length - 1, onSelect: guard(ctx, () => moveRow(grid, first, first + 1)) },
    ],
    opts.onInsertColumn ? [
      { label: 'Insert column left', icon: 'ArrowLeft', onSelect: () => opts.onInsertColumn!('left') },
      { label: 'Insert column right', icon: 'ArrowRight', onSelect: () => opts.onInsertColumn!('right') },
    ] : [],
    [{ label: many ? `Delete ${rowIds.length} rows` : 'Delete row', icon: 'Trash2', danger: true, onSelect: guard(ctx, () => deleteRows(grid, rowIds)) }],
  ]
}

/** Column header menu (Baserow field context / Sheets "Columns"). */
export function columnMenu(ctx: Ctx, column: GridColumn, opts: { onEdit: () => void; onInsert: (side: 'left' | 'right') => void; visibleIndex: number }): MenuEntry[][] {
  const { grid } = ctx
  const index = grid.columns.findIndex(c => c.id === column.id)
  const visible = grid.columns.filter(c => !c.hidden)
  const frozen = grid.frozenColumns ?? 0
  return [
    [{ label: 'Edit column', icon: 'Pencil', onSelect: opts.onEdit }],
    [
      { label: 'Insert column left', icon: 'ArrowLeft', onSelect: () => opts.onInsert('left') },
      { label: 'Insert column right', icon: 'ArrowRight', onSelect: () => opts.onInsert('right') },
      { label: 'Move column left', icon: 'ArrowLeftRight', disabled: index <= 0, onSelect: guard(ctx, () => moveColumn(grid, index, index - 1)) },
      { label: 'Move column right', icon: 'ArrowLeftRight', disabled: index >= grid.columns.length - 1, onSelect: guard(ctx, () => moveColumn(grid, index, index + 1)) },
    ],
    [
      { label: 'Sort A → Z', icon: 'ArrowDown', onSelect: guard(ctx, () => sortRows(grid, column.id, 'asc')) },
      { label: 'Sort Z → A', icon: 'ArrowUp', onSelect: guard(ctx, () => sortRows(grid, column.id, 'desc')) },
    ],
    [
      { label: 'Hide column', icon: 'EyeOff', disabled: visible.length <= 1, onSelect: guard(ctx, () => updateColumn(grid, column.id, { hidden: true })) },
      frozen === opts.visibleIndex + 1
        ? { label: 'Unfreeze columns', icon: 'PinOff', onSelect: guard(ctx, () => ({ ...grid, frozenColumns: 0 })) }
        : { label: 'Freeze up to this column', icon: 'Pin', disabled: opts.visibleIndex > 4, onSelect: guard(ctx, () => ({ ...grid, frozenColumns: opts.visibleIndex + 1 })) },
    ],
    [{ label: 'Delete column', icon: 'Trash2', danger: true, disabled: grid.columns.length <= 1, onSelect: guard(ctx, () => deleteColumn(grid, column.id)) }],
  ]
}

export function insertColumnAt(grid: SynopsisGrid, anchorId: string, side: 'left' | 'right', draft: Pick<GridColumn, 'name' | 'type' | 'options'>): SynopsisGrid {
  const index = grid.columns.findIndex(c => c.id === anchorId)
  const column = { ...makeColumn(draft.name, draft.type), ...(draft.options ? { options: draft.options } : {}) }
  return insertColumn(grid, side === 'left' ? index : index + 1, column)
}
