import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import {
  CUSTOM_GROUP, GRID_GROUPS, columnIdFromOrderToken, isHiddenColumnOrderToken,
  orderedColumnIds, setColumnVisibility, showAllColumnIds, type GridColumnMeta,
} from '../gridColumns'

const groupLabel = (id: string) => (id === CUSTOM_GROUP.id ? CUSTOM_GROUP.label : GRID_GROUPS.find((g) => g.id === id)?.label ?? id)

/** Column visibility + order in one control. State is a single ORDERED id list
 *  (the same array saved views persist): position = display order, absence =
 *  hidden. This panel is the ONE place to move / hide / show a column — the
 *  header menu only links here ("Manage column…"). */
export function ColumnsPanel({ all, visible, columnOrder, onChange, focusId }: {
  all: GridColumnMeta[]
  /** Visible columns, in display order. */
  visible: GridColumnMeta[]
  /** Persisted full order including hidden column slots. */
  columnOrder?: string[]
  onChange: (orderedVisibleIds: string[]) => void
  /** The column whose header opened this panel: scrolled to and highlighted. */
  focusId?: string | null
}) {
  const focusRef = useRef<HTMLLIElement>(null)
  useEffect(() => { focusRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [focusId])
  const visibleIds = visible.map((c) => c.id)
  const order = orderedColumnIds(all, columnOrder)
  const byId = new Map(all.map((column) => [column.id, column]))
  const hidden = order
    .filter(isHiddenColumnOrderToken)
    .map(columnIdFromOrderToken)
    .map((id) => byId.get(id))
    .filter((column): column is GridColumnMeta => !!column)

  // Reorder by dragging a row anywhere up or down the list (or Alt+↑/↓ on its handle, for the keyboard).
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const moveTo = (fromId: string, toId: string) => {
    const ids = [...visibleIds]
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0 || from === to) return
    ids.splice(from, 1)
    ids.splice(to, 0, fromId)
    let shownIndex = 0
    const currentIds = new Set(all.map((column) => column.id))
    onChange(order.map((token) => {
      const id = columnIdFromOrderToken(token)
      return isHiddenColumnOrderToken(token) || !currentIds.has(id) ? token : ids[shownIndex++]
    }))
  }
  const nudge = (index: number, delta: -1 | 1) => {
    const target = visible[index + delta]
    if (target) moveTo(visible[index].id, target.id)
  }
  const hide = (id: string) => onChange(setColumnVisibility(all, columnOrder, id, false))
  const show = (id: string) => onChange(setColumnVisibility(all, columnOrder, id, true))
  const showAll = () => onChange(showAllColumnIds(all, columnOrder))

  return (
    <div className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 p-3" data-testid="columns-panel">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Shown ({visible.length})</h3>
          <Button variant="ghost" size="sm" onClick={showAll}>Show all</Button>
        </div>
        <ul className="flex flex-col">
          {visible.map((c, i) => (
            <li
              key={c.id} ref={c.id === focusId ? focusRef : undefined} data-testid="shown-column"
              aria-current={c.id === focusId ? 'true' : undefined}
              draggable
              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); setDragId(c.id) }}
              onDragOver={(e) => { if (dragId && dragId !== c.id) { e.preventDefault(); setOverId(c.id) } }}
              onDrop={(e) => { e.preventDefault(); if (dragId) moveTo(dragId, c.id); setDragId(null); setOverId(null) }}
              onDragEnd={() => { setDragId(null); setOverId(null) }}
              className={cn(
                'flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-goms-sky/[0.1]',
                c.id === focusId && 'bg-goms-sky/20 ring-1 ring-goms-sky',
                dragId === c.id && 'opacity-40',
                overId === c.id && 'shadow-[inset_0_2px_0_#4CA7DD]',
              )}
            >
              <button
                type="button" aria-label={`Drag to reorder ${c.header}`} title="Drag up or down to reorder"
                onKeyDown={(e) => {
                  if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); nudge(i, -1) }
                  if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); nudge(i, 1) }
                }}
                className="flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted hover:text-ink active:cursor-grabbing focus-visible:focus-ring"
              >
                <Icon name="GripVertical" size={14} />
              </button>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                {c.header} <span className="text-[11px] text-muted">· {groupLabel(c.group)}</span>
              </span>
              {/* The last column stays: an empty list would mean "show every column". */}
              <Button
                variant="ghost" size="icon" aria-label={`Hide ${c.header}`} disabled={visible.length === 1}
                title={visible.length === 1 ? 'At least one column must stay' : 'Hide from this view'} onClick={() => hide(c.id)}>
                <Icon name="EyeOff" size={14} />
              </Button>
              <Button
                variant="ghost" size="icon" aria-label={`Delete ${c.header}`}
                disabled={visible.length === 1}
                title="Remove from this view (restore anytime under Hidden)"
                onClick={() => hide(c.id)}
              >
                <Icon name="Trash2" size={14} />
              </Button>
            </li>
          ))}
        </ul>
      </div>
      {hidden.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Hidden ({hidden.length})</h3>
          <ul className="flex flex-col">
            {hidden.map((c) => (
              <li key={c.id} className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-ink-900/[0.04]">
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                  {c.header} <span className="text-[11px]">· {groupLabel(c.group)}</span>
                </span>
                <Button variant="ghost" size="sm" aria-label={`Show ${c.header}`} title={`Restore ${c.header}`} onClick={() => show(c.id)}>
                  <Icon name="Eye" size={14} />Restore
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
