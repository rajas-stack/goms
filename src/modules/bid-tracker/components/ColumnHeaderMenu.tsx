import { useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { cn } from '@/lib/utils'

function Item({ icon, children, onClick, disabled }: {
  icon: string; children: ReactNode; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      type="button" role="menuitem" disabled={disabled} onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink hover:bg-goms-sky/[0.14] disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon name={icon} size={14} className="shrink-0" /> {children}
    </button>
  )
}

/** The per-column menu in a grid header: quick actions for THIS column — sort,
 *  filter — and "Manage column…", which opens the Columns panel on it. Moving,
 *  hiding, renaming and archiving live only in that panel, so each action has
 *  exactly one home. */
export function ColumnHeaderMenu({ header, sorted, canSort, onSort, onFilter, onManage }: {
  header: string
  sorted: false | 'asc' | 'desc'
  canSort: boolean
  onSort: (dir: 'asc' | 'desc' | false) => void
  onFilter: (() => void) | null
  onManage: () => void
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
          'flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-goms-navy/[0.1] hover:text-goms-navy focus-visible:focus-ring',
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
            <Item icon="List" onClick={run(onManage)}>Manage column…</Item>
          </motion.div>
        )}
      </PopoverPanel>
    </div>
  )
}
