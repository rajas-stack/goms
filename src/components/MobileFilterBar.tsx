import { useState, type ReactNode } from 'react'
import { Icon } from './ui/Icon'
import { cn } from '@/lib/utils'

/** Collapses a screen's filter controls behind a "Filter" button below `sm:`,
 *  and leaves them permanently inline from `sm:` up.
 *
 *  A row of four-to-seven dropdowns is a desktop pattern: on a phone the same
 *  controls stack into a wall that pushes the actual results off-screen. This
 *  keeps the list the first thing you see and puts the filters one tap away,
 *  the way a mobile app normally handles them. The visibility switch is pure
 *  CSS (`hidden sm:block`) rather than a JS breakpoint check, so there's no
 *  flash or resize handler — `open` only ever matters below `sm`.
 *
 *  `children` keeps its own layout classes (grid/flex/wrap); this component
 *  only decides whether the wrapper is shown. */
export function MobileFilterBar({ activeCount, children }: {
  /** How many filters are currently set — shown as a badge on the button so
   *  active filters are visible without opening the panel. */
  activeCount: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] font-medium text-ink-800 transition-colors sm:hidden',
          open && 'border-ink-600 bg-panel',
        )}
      >
        <Icon name="SlidersHorizontal" size={15} />
        Filter
        {activeCount > 0 && (
          <span className="rounded-full bg-ink-900 px-1.5 py-0.5 text-[10px] font-semibold text-paper">
            {activeCount}
          </span>
        )}
        <Icon name="ChevronDown" size={14} className={cn('text-muted transition-transform', open && 'rotate-180')} />
      </button>

      <div className={cn(open || 'hidden sm:block')}>{children}</div>
    </>
  )
}
