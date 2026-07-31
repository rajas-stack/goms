import { forwardRef } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { ChargeBadge, RelationshipSummary } from '@/components/ui/Badge'
import { employeeAccent } from '@/lib/node-colors'
import { cn, initials } from '@/lib/utils'
import type { Employee } from '@/lib/types'

interface Props {
  employee: Employee
  selected: boolean
  expanded: boolean
  canExpand: boolean
  showMetadata?: boolean
  isDeptHead?: boolean
  dropActive?: boolean
  dragging?: boolean
  onSelect: () => void
  onToggle: () => void
  onAdd: () => void
}

export const EmployeeCard = forwardRef<HTMLDivElement, Props>(
  ({ employee, selected, expanded, canExpand, showMetadata, isDeptHead, dropActive, dragging, onSelect, onToggle, onAdd }, ref) => {
    const accent = employeeAccent(employee)
    const vacant = employee.vacant
    return (
      <motion.div
        ref={ref}
        data-canvas-card
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18 }}
        // See the matching comment in NodeCard.tsx: this card's mount-in
        // scale animation promotes it to its own GPU layer, and Chrome on
        // Windows can leave the OS cursor invisible once that layer is torn
        // down — most visible right after the canvas first loads, while
        // dozens of cards animate in as data streams in. Forcing a cursor
        // value change recomputes it immediately instead of waiting for the
        // pointer to leave and re-enter the window.
        onAnimationComplete={() => {
          const root = document.documentElement
          root.style.cursor = 'default'
          requestAnimationFrame(() => { root.style.cursor = '' })
        }}
        onClick={onSelect}
        className={cn(
          'group relative flex w-[220px] cursor-grab items-start gap-2.5 rounded-card border px-3.5 py-3 shadow-panel transition-colors active:cursor-grabbing',
          vacant ? 'border-dashed bg-amber-100/40' : 'bg-white',
          selected
            ? cn(accent.border, 'ring-2', accent.ring)
            : vacant ? 'border-amber' : 'border-line hover:border-emerald-600',
          dropActive && 'border-teal-600 ring-2 ring-teal-600',
          dragging && 'opacity-50',
        )}
      >
        {vacant ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <Icon name="UserX" size={17} />
          </span>
        ) : employee.photoUrl ? (
          <img
            src={employee.photoUrl}
            alt={employee.name}
            className="h-9 w-9 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-display text-[13px] font-bold', accent.chip)}>
            {initials(employee.name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {vacant ? (
            <>
              <div className="break-words text-[13px] font-semibold text-amber-600">Vacant position</div>
              <div className="break-words text-[11px] text-muted">{employee.designation || 'Unfilled seat'}</div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="break-words text-[13px] font-semibold text-ink-900">{employee.name}</span>
                {isDeptHead && (
                  <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600">
                    <Icon name="Star" size={9} /> Head
                  </span>
                )}
              </div>
              <div className="break-words text-[11px] text-muted">{employee.designation}</div>
            </>
          )}

          {!vacant && <div className="mt-1.5"><RelationshipSummary employee={employee} /></div>}

          {employee.charges.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {employee.charges.slice(0, 2).map((c) => <ChargeBadge key={c.id} charge={c} />)}
              {employee.charges.length > 2 && (
                <span className="text-[10px] text-muted">+{employee.charges.length - 2}</span>
              )}
            </div>
          )}

          {showMetadata && !vacant && (
            <div className="mt-1 space-y-0.5">
              <div className="truncate text-[10px] text-muted">{employee.email}</div>
              <div className="truncate text-[10px] text-muted">{employee.phone}</div>
            </div>
          )}
        </div>

        {canExpand && (
          <Tooltip
            label={expanded ? 'Collapse' : 'Show direct reports'}
            side="bottom"
            className="absolute -bottom-3 left-1/2 -translate-x-1/2"
          >
            <button
              onClick={(e) => { e.stopPropagation(); onToggle() }}
              aria-label={expanded ? 'Collapse' : 'Show direct reports'}
              className={cn(
                // Visible circle stays 24px (unchanged look); `before:` grows the
                // actual hit area to the ≥44dp touch-target minimum without
                // shifting layout or the card's absolute positioning.
                'relative flex h-6 w-6 items-center justify-center rounded-full border bg-white text-muted shadow-sm transition-colors before:absolute before:-inset-2.5 before:content-[\'\'] hover:border-emerald-600 hover:text-ink-900',
                expanded && 'border-emerald-600 text-ink-900',
              )}
            >
              <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
                <Icon name="ChevronDown" size={13} />
              </motion.span>
            </button>
          </Tooltip>
        )}

        <Tooltip
          label={vacant ? 'Assign / add reportee' : 'Add Reportee (junior)'}
          side="left"
          className="absolute -right-3 -top-3 opacity-0 group-hover:opacity-100"
        >
          <button
            onClick={(e) => { e.stopPropagation(); onAdd() }}
            aria-label="Add reportee"
            // Visible circle stays 28px; `before:` expands the hit area to
            // ≥44dp without changing the visible affordance or its position.
            className="relative flex h-7 w-7 items-center justify-center rounded-full border border-line bg-white text-muted shadow-sm transition-all before:absolute before:-inset-2 before:content-[''] hover:border-emerald-600 hover:text-ink-900"
          >
            <Icon name="Plus" size={14} />
          </button>
        </Tooltip>
      </motion.div>
    )
  },
)
EmployeeCard.displayName = 'EmployeeCard'
