import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Side = 'top' | 'bottom' | 'left' | 'right'

const POSITION: Record<Side, string> = {
  top: 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-1.5 -translate-x-1/2',
  left: 'right-full top-1/2 mr-1.5 -translate-y-1/2',
  right: 'left-full top-1/2 ml-1.5 -translate-y-1/2',
}

/** Lightweight hover tooltip for icon-only buttons — CSS-only (no JS positioning),
 *  so it stays cheap to sprinkle across toolbars. Pick `side` to keep it clear
 *  of viewport edges and neighboring UI. */
export function Tooltip({ label, side = 'top', className, children }: {
  label: string
  side?: Side
  className?: string
  children: ReactNode
}) {
  return (
    <span className={cn('group/tooltip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-30 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-[11px] font-medium text-paper opacity-0 shadow-pop transition-opacity duration-150 group-hover/tooltip:opacity-100',
          POSITION[side],
        )}
      >
        {label}
      </span>
    </span>
  )
}
