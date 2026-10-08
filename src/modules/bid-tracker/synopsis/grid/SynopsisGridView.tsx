import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { GRID_LIMITS, type GridCellValue, type GridColumn, type SynopsisGrid } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { GridContextMenu, type MenuEntry } from '../../components/GridContextMenu'
import { CellDisplay, CellEditor, type CommitMove } from './GridCell'
import { FieldEditor, type FieldDraft } from './FieldEditor'
import { columnMenu, insertColumnAt, rowMenu } from './gridMenus'
import {
  cellText, FIELD_TYPE_ICONS, insertRow, makeOption, moveColumn, moveRow, parseClipboard, pasteText, setCell, updateColumn,
} from './gridModel'

const DEFAULT_WIDTH = 180
const GUTTER = 56
const ROW_HEIGHT = 34

interface Pos { r: number; c: number }
interface Range { r1: number; r2: number; c1: number; c2: number }
type Drag = { kind: 'row' | 'column'; from: number; over: number } | null
type FieldDialog = { mode: 'edit'; column: GridColumn } | { mode: 'insert'; anchorId: string; side: 'left' | 'right' } | null

export interface SynopsisGridViewProps {
  grid: SynopsisGrid
  onChange: (next: SynopsisGrid) => void
  readOnly?: boolean
  label: string
  onUndo?: () => void
  onRedo?: () => void
  onError: (message: string) => void
}

/** Baserow-style editable grid: typed columns, drag to reorder rows/columns,
 *  resize, freeze, range selection, keyboard editing and Sheets-compatible
 *  copy/paste (tab-separated). */
export function SynopsisGridView({ grid, onChange, readOnly = false, label, onUndo, onRedo, onError }: SynopsisGridViewProps) {
  const columns = useMemo(() => grid.columns.filter(c => !c.hidden), [grid.columns])
  const [anchorRaw, setAnchor] = useState<Pos>({ r: 0, c: 0 })
  const [focusRaw, setFocus] = useState<Pos>({ r: 0, c: 0 })
  // Tied to the cell being edited (by id), not to the selection, so clicking
  // elsewhere commits this cell instead of losing it.
  const [editing, setEditing] = useState<{ rowId: string; columnId: string; seed: string | null } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; title: string; groups: MenuEntry[][] } | null>(null)
  const [fieldDialog, setFieldDialog] = useState<FieldDialog>(null)
  const [drag, setDrag] = useState<Drag>(null)
  const [resize, setResize] = useState<{ id: string; width: number } | null>(null)
  const selecting = useRef(false)
  const root = useRef<HTMLDivElement>(null)

  const rows = grid.rows
  const clamp = (p: Pos): Pos => ({ r: Math.max(0, Math.min(rows.length - 1, p.r)), c: Math.max(0, Math.min(columns.length - 1, p.c)) })
  // Re-clamped every render: undo / delete / hide can shrink the grid under the selection.
  const anchor = clamp(anchorRaw), focus = clamp(focusRaw)
  const range: Range = { r1: Math.min(anchor.r, focus.r), r2: Math.max(anchor.r, focus.r), c1: Math.min(anchor.c, focus.c), c2: Math.max(anchor.c, focus.c) }
  const inRange = (r: number, c: number, rg: Range = range) => r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2
  const widthOf = (column: GridColumn) => (resize?.id === column.id ? resize.width : column.width ?? DEFAULT_WIDTH)
  const frozen = Math.min(grid.frozenColumns ?? 0, columns.length)
  const leftOffsets = columns.reduce<number[]>((acc, column, i) => [...acc, i === 0 ? GUTTER : acc[i - 1] + widthOf(columns[i - 1])], [])

  // Latest grid, so two changes in one event (create option, then set the
  // cell to it) build on each other instead of the stale render's grid.
  const latest = useRef(grid)
  latest.current = grid
  const apply = (next: SynopsisGrid) => { latest.current = next; onChange(next) }
  const ctx = { grid, apply, onError }
  const select = (p: Pos, extend = false) => {
    const next = clamp(p)
    if (!extend) setAnchor(next)
    setFocus(next)
    root.current?.querySelector<HTMLElement>(`[data-pos="${next.r}:${next.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const startEditing = (seed: string | null) => {
    const row = rows[focus.r], column = columns[focus.c]
    if (!row || !column || readOnly) return
    setAnchor(focus)
    // A date picker cannot take a typed character as its start value.
    setEditing({ rowId: row.id, columnId: column.id, seed: column.type === 'date' ? null : seed })
  }

  const commit = (value: GridCellValue, move: CommitMove) => {
    const target = editing
    setEditing(null)
    if (!target) return
    const current = latest.current
    const before = current.rows.find(x => x.id === target.rowId)?.cells[target.columnId]
    if (JSON.stringify(before ?? null) !== JSON.stringify(value ?? null) && current.rows.some(x => x.id === target.rowId)) {
      apply(setCell(current, target.rowId, target.columnId, value))
    }
    const r = rows.findIndex(x => x.id === target.rowId), c = columns.findIndex(x => x.id === target.columnId)
    if (move === 'down') select({ r: r + 1, c })
    else if (move === 'right') select({ r, c: c + 1 })
    else if (move === 'left') select({ r, c: c - 1 })
    if (move !== 'none') root.current?.focus()
  }

  const createOption = (text: string): string | null => {
    const column = latest.current.columns.find(c => c.id === editing?.columnId)
    if (!column) return null
    if ((column.options?.length ?? 0) >= GRID_LIMITS.options) { onError(`A column can have up to ${GRID_LIMITS.options} options.`); return null }
    const option = makeOption(text, column.options?.length ?? 0)
    try { apply(updateColumn(latest.current, column.id, { options: [...(column.options ?? []), option] })) } catch (error) { onError(error instanceof Error ? error.message : 'Could not add the option.'); return null }
    return option.id
  }

  const clearRange = (rg: Range = range) => {
    let next = latest.current
    for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
      const column = columns[c], row = rows[r]
      if (row && column) next = setCell(next, row.id, column.id, column.type === 'checkbox' ? false : null)
    }
    apply(next)
  }
  const rangeText = (rg: Range = range) => rows.slice(rg.r1, rg.r2 + 1)
    .map(row => columns.slice(rg.c1, rg.c2 + 1).map(column => cellText(column, row.cells[column.id]).replace(/[\t\n]/g, ' ')).join('\t')).join('\n')

  const onCopy = (event: ClipboardEvent) => { if (editing) return; event.preventDefault(); event.clipboardData.setData('text/plain', rangeText()) }
  const onCut = (event: ClipboardEvent) => { if (editing || readOnly) return; onCopy(event); clearRange() }
  const onPaste = (event: ClipboardEvent) => {
    if (editing || readOnly) return
    event.preventDefault()
    const matrix = parseClipboard(event.clipboardData.getData('text/plain'))
    try {
      const next = pasteText(grid, range.r1, columns.map(c => c.id), range.c1, matrix)
      apply(next)
      if (range.r1 + matrix.length > next.rows.length || range.c1 + Math.max(...matrix.map(line => line.length)) > columns.length) {
        onError('Some pasted cells did not fit the grid and were left out.')
      }
      setAnchor({ r: range.r1, c: range.c1 })
      setFocus({ r: Math.min(next.rows.length - 1, range.r1 + matrix.length - 1), c: Math.min(columns.length - 1, range.c1 + (matrix[0]?.length ?? 1) - 1) })
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not paste.') }
  }

  const toggleCheckbox = (r: number, c: number) => {
    const column = columns[c], row = rows[r]
    if (readOnly || column?.type !== 'checkbox' || !row) return
    apply(setCell(grid, row.id, column.id, row.cells[column.id] !== true))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    // Keys aimed at real buttons inside the grid (column menu, Add row...) are theirs.
    const target = event.target as HTMLElement
    if (target !== event.currentTarget && !target.closest('[role=gridcell]')) return
    if (editing || fieldDialog || !rows.length) return
    const mod = event.ctrlKey || event.metaKey
    const moves: Record<string, Pos> = { ArrowUp: { r: -1, c: 0 }, ArrowDown: { r: 1, c: 0 }, ArrowLeft: { r: 0, c: -1 }, ArrowRight: { r: 0, c: 1 } }
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); (event.shiftKey ? onRedo : onUndo)?.(); return }
    if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); onRedo?.(); return }
    if (event.altKey && event.shiftKey && moves[event.key] && !readOnly) {
      // Alt+Shift+Arrow moves the current row or column, like dragging it.
      event.preventDefault()
      const d = moves[event.key]
      if (d.r && rows[focus.r + d.r]) { apply(moveRow(grid, focus.r, focus.r + d.r)); select({ r: focus.r + d.r, c: focus.c }) }
      if (d.c && columns[focus.c + d.c]) {
        const from = grid.columns.findIndex(col => col.id === columns[focus.c].id), to = grid.columns.findIndex(col => col.id === columns[focus.c + d.c].id)
        apply(moveColumn(grid, from, to)); select({ r: focus.r, c: focus.c + d.c })
      }
      return
    }
    if (moves[event.key]) {
      event.preventDefault()
      const d = moves[event.key]
      // Ctrl/Cmd+Arrow jumps to the edge, Shift extends the selection.
      select(mod ? { r: d.r ? (d.r < 0 ? 0 : rows.length - 1) : focus.r, c: d.c ? (d.c < 0 ? 0 : columns.length - 1) : focus.c } : { r: focus.r + d.r, c: focus.c + d.c }, event.shiftKey)
    } else if (event.key === 'Tab') {
      // At the grid's edges Tab leaves the grid (no keyboard trap).
      const nextC = focus.c + (event.shiftKey ? -1 : 1)
      if (nextC < 0 || nextC >= columns.length) return
      event.preventDefault(); select({ r: focus.r, c: nextC })
    }
    else if (readOnly) return
    else if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault()
      if (columns[focus.c]?.type === 'checkbox') toggleCheckbox(focus.r, focus.c); else startEditing(null)
    } else if (event.key === ' ' && columns[focus.c]?.type === 'checkbox') { event.preventDefault(); toggleCheckbox(focus.r, focus.c) }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); clearRange() }
    else if (event.key.length === 1 && !mod && !event.altKey && columns[focus.c]?.type !== 'checkbox') {
      event.preventDefault(); startEditing(event.key)
    }
  }

  const openRowMenu = (event: ReactMouseEvent, r: number, c?: number) => {
    event.preventDefault()
    if (readOnly) return
    // Act on what was right-clicked: the selection if the click is inside it,
    // otherwise that cell (or the whole row, from the row number).
    const target: Range = inRange(r, c ?? range.c1) ? range
      : c === undefined ? { r1: r, r2: r, c1: 0, c2: columns.length - 1 } : { r1: r, r2: r, c1: c, c2: c }
    if (target !== range) { setAnchor({ r: target.r1, c: target.c1 }); setFocus({ r: target.r2, c: target.c2 }) }
    const ids = rows.slice(target.r1, target.r2 + 1).map(row => row.id)
    const column = c !== undefined ? columns[c] : undefined
    setMenu({
      x: event.clientX, y: event.clientY, title: `Row ${r + 1}`,
      groups: rowMenu(ctx, ids, {
        onClear: () => clearRange(target), onCopy: () => { void navigator.clipboard?.writeText(rangeText(target)) },
        columnId: column?.id, onInsertColumn: column ? side => setFieldDialog({ mode: 'insert', anchorId: column.id, side }) : undefined,
      }),
    })
  }
  const openColumnMenu = (event: ReactMouseEvent, c: number) => {
    event.preventDefault()
    if (readOnly) return
    const column = columns[c]
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({
      x: event.type === 'contextmenu' ? event.clientX : rect.left, y: event.type === 'contextmenu' ? event.clientY : rect.bottom,
      title: `${column.name} column`,
      groups: columnMenu(ctx, column, { visibleIndex: c, onEdit: () => setFieldDialog({ mode: 'edit', column }), onInsert: side => setFieldDialog({ mode: 'insert', anchorId: column.id, side }) }),
    })
  }

  const saveField = (draft: FieldDraft) => {
    try {
      if (fieldDialog?.mode === 'edit') {
        let next = grid
        if (draft.name !== fieldDialog.column.name) next = updateColumn(next, fieldDialog.column.id, { name: draft.name })
        if (draft.type !== fieldDialog.column.type) next = updateColumn(next, fieldDialog.column.id, { type: draft.type, ...(draft.options?.length ? { options: draft.options } : {}) })
        else if (draft.options) next = updateColumn(next, fieldDialog.column.id, { options: draft.options })
        apply(next)
      } else if (fieldDialog?.mode === 'insert') apply(insertColumnAt(grid, fieldDialog.anchorId, fieldDialog.side, draft))
      setFieldDialog(null)
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not save the column.') }
  }

  const startResize = (event: ReactMouseEvent, column: GridColumn) => {
    event.preventDefault(); event.stopPropagation()
    const startX = event.clientX, startWidth = widthOf(column)
    let width = startWidth
    const onMove = (e: MouseEvent) => { width = Math.max(60, Math.min(800, startWidth + e.clientX - startX)); setResize({ id: column.id, width }) }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp)
      setResize(null)
      if (width !== startWidth) apply(updateColumn(grid, column.id, { width: Math.round(width) }))
    }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }

  const endDrag = () => {
    if (!drag || drag.from === drag.over) { setDrag(null); return }
    if (drag.kind === 'row') { apply(moveRow(grid, drag.from, drag.over)); select({ r: drag.over, c: focus.c }) }
    else {
      const from = grid.columns.findIndex(col => col.id === columns[drag.from].id), to = grid.columns.findIndex(col => col.id === columns[drag.over].id)
      apply(moveColumn(grid, from, to)); select({ r: focus.r, c: drag.over })
    }
    setDrag(null)
  }
  const dropEdge = (kind: 'row' | 'column', index: number) =>
    drag?.kind === kind && drag.over === index && drag.from !== index ? (drag.from < index ? 'after' : 'before') : null

  const hiddenCount = grid.columns.length - columns.length
  const stickyLeft = (c: number) => (c < frozen ? { position: 'sticky' as const, left: leftOffsets[c], zIndex: 2 } : undefined)

  return (
    <div className="min-w-0">
      <div ref={root} role="grid" aria-label={label} aria-rowcount={rows.length + 1} aria-colcount={columns.length} aria-readonly={readOnly}
        tabIndex={0} onKeyDown={onKeyDown} onCopy={onCopy} onCut={onCut} onPaste={onPaste}
        className="relative max-h-[70vh] overflow-auto border-y border-line bg-white outline-none focus-visible:ring-2 focus-visible:ring-goms-sky">
        <table className="border-separate border-spacing-0 text-[13px]" style={{ tableLayout: 'fixed', width: GUTTER + columns.reduce((sum, c) => sum + widthOf(c), 0) + (readOnly ? 0 : 44) }}>
          <colgroup>
            <col style={{ width: GUTTER }} />
            {columns.map(column => <col key={column.id} style={{ width: widthOf(column) }} />)}
            {!readOnly && <col style={{ width: 44 }} />}
          </colgroup>
          <thead>
            <tr role="row">
              <th className="sticky left-0 top-0 z-[4] border-b border-r border-line bg-grid-head px-2 text-left text-[11px] font-medium text-muted" style={{ height: ROW_HEIGHT }}>
                {hiddenCount > 0 && !readOnly
                  ? <button type="button" title="Show hidden columns" onClick={() => apply({ ...grid, columns: grid.columns.map(c => ({ ...c, hidden: false })) })}
                      className="inline-flex items-center gap-0.5 text-goms-navy hover:underline"><Icon name="Eye" size={12} />{hiddenCount}</button>
                  : null}
              </th>
              {columns.map((column, c) => (
                <th key={column.id} role="columnheader" scope="col" draggable={!readOnly}
                  onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', column.name); setDrag({ kind: 'column', from: c, over: c }) }}
                  onDragOver={event => { if (drag?.kind === 'column') { event.preventDefault(); if (drag.over !== c) setDrag({ ...drag, over: c }) } }}
                  onDrop={event => { event.preventDefault(); endDrag() }} onDragEnd={() => setDrag(null)}
                  onContextMenu={event => openColumnMenu(event, c)} onDoubleClick={() => !readOnly && setFieldDialog({ mode: 'edit', column })}
                  style={{ height: ROW_HEIGHT, ...(c < frozen ? { left: leftOffsets[c], zIndex: 4 } : {}) }}
                  className={cn('group sticky top-0 z-[3] border-b border-r border-line bg-grid-head px-2 text-left font-medium text-ink-800',
                    !readOnly && 'cursor-grab', drag?.kind === 'column' && drag.from === c && 'opacity-50',
                    c === frozen - 1 && 'shadow-[var(--grid-frozen-shadow)]',
                    dropEdge('column', c) === 'before' && 'shadow-[inset_3px_0_0_0_rgb(var(--c-goms-navy))]',
                    dropEdge('column', c) === 'after' && 'shadow-[inset_-3px_0_0_0_rgb(var(--c-goms-navy))]')}>
                  <div className="flex items-center gap-1.5">
                    <Icon name={FIELD_TYPE_ICONS[column.type]} size={13} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate" title={column.name}>{column.name}</span>
                    {!readOnly && (
                      <button type="button" aria-label={`${column.name} column menu`} onClick={event => openColumnMenu(event, c)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:bg-grid-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100">
                        <Icon name="ChevronDown" size={13} />
                      </button>
                    )}
                  </div>
                  {!readOnly && <span aria-hidden onMouseDown={event => startResize(event, column)} onDragStart={event => event.preventDefault()}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-goms-sky" />}
                </th>
              ))}
              {!readOnly && (
                <th className="sticky top-0 z-[3] border-b border-line bg-grid-head">
                  <button type="button" aria-label="Add column" title="Add column"
                    onClick={() => columns.length && setFieldDialog({ mode: 'insert', anchorId: columns[columns.length - 1].id, side: 'right' })}
                    className="flex h-full w-full items-center justify-center text-muted hover:bg-grid-hover hover:text-ink" style={{ height: ROW_HEIGHT }}>
                    <Icon name="Plus" size={14} />
                  </button>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.id} role="row" aria-rowindex={r + 2}
                onDragOver={event => { if (drag?.kind === 'row') { event.preventDefault(); if (drag.over !== r) setDrag({ ...drag, over: r }) } }}
                onDrop={event => { event.preventDefault(); endDrag() }}
                className={cn('group/row', drag?.kind === 'row' && drag.from === r && 'opacity-50',
                  dropEdge('row', r) === 'before' && '[&>td]:shadow-[inset_0_3px_0_0_rgb(var(--c-goms-navy))]',
                  dropEdge('row', r) === 'after' && '[&>td]:shadow-[inset_0_-3px_0_0_rgb(var(--c-goms-navy))]')}>
                <td onContextMenu={event => openRowMenu(event, r)}
                  onClick={() => { setAnchor({ r, c: 0 }); setFocus({ r, c: columns.length - 1 }); root.current?.focus() }}
                  className={cn('sticky left-0 z-[2] border-b border-r border-line bg-grid-head px-1 text-center text-[11px] tabular-nums text-muted',
                    r >= range.r1 && r <= range.r2 && 'bg-grid-selected text-ink')} style={{ height: ROW_HEIGHT }}>
                  <div className="flex items-center justify-center gap-0.5">
                    {!readOnly && (
                      <span draggable aria-label={`Drag row ${r + 1}`} title="Drag to move row (or Alt+Shift+↑/↓)"
                        onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(r + 1)); setDrag({ kind: 'row', from: r, over: r }) }}
                        onDragEnd={() => setDrag(null)}
                        className="cursor-grab text-muted opacity-0 group-hover/row:opacity-100"><Icon name="GripVertical" size={13} /></span>
                    )}
                    <span>{r + 1}</span>
                  </div>
                </td>
                {columns.map((column, c) => {
                  const active = focus.r === r && focus.c === c
                  const isEditing = !!editing && editing.rowId === row.id && editing.columnId === column.id && !readOnly
                  return (
                    <td key={column.id} role="gridcell" data-pos={`${r}:${c}`} aria-selected={inRange(r, c)}
                      onMouseDown={event => {
                        if (event.button !== 0 || isEditing) return
                        select({ r, c }, event.shiftKey); selecting.current = true
                        const stop = () => { selecting.current = false; window.removeEventListener('mouseup', stop) }
                        window.addEventListener('mouseup', stop)
                        if (!event.shiftKey) root.current?.focus({ preventScroll: true })
                      }}
                      onMouseEnter={() => { if (selecting.current) setFocus({ r, c }) }}
                      onClick={() => { if (column.type === 'checkbox' && active) toggleCheckbox(r, c) }}
                      onDoubleClick={() => { if (column.type !== 'checkbox') startEditing(null) }}
                      onContextMenu={event => openRowMenu(event, r, c)}
                      style={{ height: ROW_HEIGHT, ...stickyLeft(c) }}
                      className={cn('relative border-b border-r border-line px-2 align-middle text-ink',
                        c < frozen ? 'bg-grid-frozen' : 'bg-white', inRange(r, c) && !active && 'bg-grid-selected',
                        c === frozen - 1 && 'shadow-[var(--grid-frozen-shadow)]',
                        active && 'outline outline-2 -outline-offset-2 outline-goms-navy')}>
                      {isEditing
                        ? <div className="absolute inset-0 z-20"><CellEditor column={column} value={row.cells[column.id]} seed={editing!.seed}
                            onCommit={commit} onCancel={() => { setEditing(null); root.current?.focus() }} onCreateOption={createOption} /></div>
                        : <div className="flex h-full items-center overflow-hidden"><CellDisplay column={column} value={row.cells[column.id]} /></div>}
                    </td>
                  )
                })}
                {!readOnly && <td className="border-b border-line" />}
              </tr>
            ))}
          </tbody>
        </table>
        {!readOnly && (
          <button type="button" onClick={() => { try { apply(insertRow(grid, rows.length)); const p = { r: rows.length, c: focus.c }; setAnchor(p); setFocus(p) } catch (error) { onError(error instanceof Error ? error.message : 'Could not add a row.') } }}
            className="sticky left-0 flex h-9 items-center gap-1.5 px-3 text-[13px] text-muted hover:text-ink">
            <Icon name="Plus" size={14} /> Add row
          </button>
        )}
      </div>
      {menu && <GridContextMenu x={menu.x} y={menu.y} title={menu.title} groups={menu.groups} onClose={() => { setMenu(null); root.current?.focus() }} />}
      {fieldDialog && (
        <FieldEditor
          title={fieldDialog.mode === 'edit' ? 'Edit column' : 'New column'}
          column={fieldDialog.mode === 'edit' ? fieldDialog.column : { name: `Column ${grid.columns.length + 1}`, type: 'text' }}
          onSave={saveField} onClose={() => setFieldDialog(null)} />
      )}
    </div>
  )
}
