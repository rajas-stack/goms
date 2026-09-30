import { useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { cn } from '@/lib/utils'

function Item({ icon, children, onClick, disabled, danger }: {
  icon: string; children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean
}) {
  return (
    <button
      type="button" role="menuitem" disabled={disabled} onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-ink-900/[0.06] disabled:pointer-events-none disabled:opacity-40',
        danger ? 'text-crimson' : 'text-ink',
      )}
    >
      <Icon name={icon} size={14} className="shrink-0" /> {children}
    </button>
  )
}

/** The per-column menu in a grid header: sort, filter, move and — for every
 *  column, standard or custom — Remove column. Removing only takes the column
 *  out of the current view (its data is untouched); the Columns panel restores it. */
export function ColumnHeaderMenu({ header, sorted, canSort, canMoveLeft, canMoveRight, canRemove, onSort, onFilter, onMove, onRemove }: {
  header: string
  sorted: false | 'asc' | 'desc'
  canSort: boolean
  canMoveLeft: boolean
  canMoveRight: boolean
  canRemove: boolean
  onSort: (dir: 'asc' | 'desc' | false) => void
  onFilter: (() => void) | null
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const run = (fn: () => void) => () => { setOpen(false); fn() }
  return (
    <div ref={anchorRef} className="relative shrink-0">
      <button
        type="button" aria-label={`${header} column menu`} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-ink-900/[0.1] hover:text-ink focus-visible:focus-ring',
          open ? 'opacity-100' : 'opacity-0 group-hover/th:opacity-100 focus-visible:opacity-100',
        )}
      >
        <Icon name="ChevronDown" size={13} />
      </button>
      <PopoverPanel open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} align="end" maxPanelHeight={360}>
        {({ maxHeight }) => (
          <motion.div
            data-canvas-ui role="menu" aria-label={`${header} column`}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.1 }}
            style={{ maxHeight }} className="w-52 overflow-y-auto rounded-xl border border-line bg-paper p-1 shadow-pop"
          >
            {canSort && (
              <>
                <Item icon="ArrowUp" disabled={sorted === 'asc'} onClick={run(() => onSort('asc'))}>Sort ascending</Item>
                <Item icon="ArrowDown" disabled={sorted === 'desc'} onClick={run(() => onSort('desc'))}>Sort descending</Item>
                {sorted && <Item icon="RotateCcw" onClick={run(() => onSort(false))}>Clear sort</Item>}
              </>
            )}
            {onFilter && <Item icon="SlidersHorizontal" onClick={run(onFilter)}>Filter by this column</Item>}
            <div className="my-1 h-px bg-line" />
            <Item icon="ArrowLeft" disabled={!canMoveLeft} onClick={run(() => onMove(-1))}>Move left</Item>
            <Item icon="ArrowRight" disabled={!canMoveRight} onClick={run(() => onMove(1))}>Move right</Item>
            <div className="my-1 h-px bg-line" />
            <Item icon="EyeOff" danger disabled={!canRemove} onClick={run(onRemove)}>Remove column</Item>
            <p className="px-2 pb-1 pt-0.5 text-[11px] leading-snug text-muted">
              Only removes it from this view. Bring it back any time from Columns.
            </p>
          </motion.div>
        )}
      </PopoverPanel>
    </div>
  )
}
