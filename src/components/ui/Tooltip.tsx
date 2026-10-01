import { useRef, useState, type ReactNode } from 'react'
import { useClampToAncestor } from './useClampToAncestor'
import { cn } from '@/lib/utils'

type Side = 'top' | 'bottom' | 'left' | 'right'

const POSITION: Record<Side, string> = {
  top: 'bottom-full left-1/2 mb-1.5',
  bottom: 'top-full left-1/2 mt-1.5',
  left: 'right-full top-1/2 mr-1.5',
  right: 'left-full top-1/2 ml-1.5',
}

const CENTER: Record<Side, string> = {
  top: 'translate(calc(-50% + var(--nudge-x, 0px)), var(--nudge-y, 0px))',
  bottom: 'translate(calc(-50% + var(--nudge-x, 0px)), var(--nudge-y, 0px))',
  left: 'translate(var(--nudge-x, 0px), calc(-50% + var(--nudge-y, 0px)))',
  right: 'translate(var(--nudge-x, 0px), calc(-50% + var(--nudge-y, 0px)))',
}

/** Hover tooltip for icon-only buttons. Tracks hover in JS (not pure CSS
 *  `:hover`) so it can use the same edge-clamping (`useClampToAncestor`) as
 *  Menu/Combobox — a tooltip centered under a trigger near the screen edge
 *  (e.g. the leftmost "Back" button or the rightmost toolbar icon) would
 *  otherwise render partly off-screen and get visually clipped. */
export function Tooltip({ label, side = 'top', className, children }: {
  label: string
  side?: Side
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const clampStyle = useClampToAncestor(open, tooltipRef)

  return (
    <span
      className={cn('relative inline-flex', className)}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <span
        ref={tooltipRef}
        role="tooltip"
        style={{ ...clampStyle, transform: CENTER[side] }}
        className={cn(
          // Not laid out at all unless open (`hidden`, `lg:block` only while
          // open): a hover tooltip has no meaning on touch devices, and a
          // closed `whitespace-nowrap` box — even at `opacity-0` — still
          // widens every scroll container it sits in (phantom horizontal
          // scrollbars, e.g. in the details sidebar), because the edge clamp
          // below only runs while open.
          'pointer-events-none absolute z-30 hidden whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-[11px] font-medium text-paper shadow-pop',
          open && 'lg:block',
          POSITION[side],
        )}
      >
        {label}
      </span>
    </span>
  )
}
