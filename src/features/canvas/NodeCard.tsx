import { forwardRef } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { CodeChip } from '@/components/ui/Badge'
import { fieldsForType } from '@/features/nodes/metadata-fields'
import { NODE_TYPE_MAP, childTypesOf } from '@/lib/node-types'
import { nodeAccent } from '@/lib/node-colors'
import { cn } from '@/lib/utils'
import type { HierNode } from '@/lib/types'

const EMPLOYEE_ADDERS = new Set(['department', 'branch', 'division', 'office', 'unit'])

interface Props {
  node: HierNode
  selected: boolean
  expanded: boolean
  canExpand: boolean
  showMetadata?: boolean
  /** Drag-and-drop: this card is a valid, hovered drop target. */
  dropActive?: boolean
  /** Drag-and-drop: this card is the one being dragged. */
  dragging?: boolean
  childCountLabel?: string
  /** Top-of-chain people in this department's reporting hierarchy — shown on
   *  department cards only, so at-a-glance you can see who runs it. */
  headNames?: string[]
  onSelect: () => void
  onToggle: () => void
  onAdd: () => void
  /** Opens the "move an existing employee here" flow instead of creating a
   *  new one. Only meaningful (and only rendered) on employee-adder nodes. */
  onSelectEmployee?: () => void
  /** Creates a real child node (e.g. a branch under a department) alongside
   *  the employee actions above. Only meaningful (and only rendered) on
   *  employee-adder nodes that also have a declared child type — a plain
   *  `unit` has neither, so it never gets this third option. */
  onAddChild?: () => void
}

export const NodeCard = forwardRef<HTMLDivElement, Props>(
  ({ node, selected, expanded, canExpand, showMetadata, dropActive, dragging, childCountLabel, headNames, onSelect, onToggle, onAdd, onSelectEmployee, onAddChild }, ref) => {
    const type = NODE_TYPE_MAP[node.typeKey]
    const accent = nodeAccent(node)
    const isDepartment = node.typeKey === 'department'
    const isBranch = node.typeKey === 'branch'
    const addsEmployee = node.domain === 'org' && EMPLOYEE_ADDERS.has(node.typeKey)
    // `childTypesOf` falls back to every type in the domain once a type's own
    // `childKeys` is empty, so a real child type is only trusted when the
    // type declares one explicitly — otherwise a true leaf like `unit` would
    // wrongly get an "Add department" option.
    const realChildType = (NODE_TYPE_MAP[node.typeKey]?.childKeys.length ?? 0) > 0 ? childTypesOf(node.typeKey)[0] : undefined
    const childLabel = addsEmployee ? 'Employee' : realChildType?.label
    const metaField = showMetadata
      ? fieldsForType(node.typeKey, node.domain).find((f) => node.metadata[f.key])
      : undefined

    return (
      <motion.div
        ref={ref}
        data-canvas-card
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18 }}
        // The scale animation promotes this card to its own GPU compositing
        // layer for the transition's duration. Chrome on Windows can leave
        // the OS cursor invisible once that layer is torn down at the end —
        // the same class of bug as the map/drag-cursor fixes elsewhere in
        // this codebase (see IndiaMap.tsx, CanvasBranch.tsx). It's especially
        // visible right after the canvas first loads, when dozens of cards
        // animate in as data streams in across a few seconds. Forcing an
        // explicit cursor value and releasing it a frame later makes Chrome
        // recompute it immediately instead of waiting for the pointer to
        // leave and re-enter the window.
        onAnimationComplete={() => {
          const root = document.documentElement
          root.style.cursor = 'default'
          requestAnimationFrame(() => { root.style.cursor = '' })
        }}
        onClick={onSelect}
        className={cn(
          'group relative flex w-[220px] cursor-grab flex-col gap-1.5 rounded-card border bg-white px-4 py-3 shadow-panel transition-colors active:cursor-grabbing',
          selected ? cn(accent.border, 'ring-2', accent.ring) : 'border-line hover:border-ink-600',
          dropActive && 'border-teal-600 ring-2 ring-teal-600',
          dragging && 'opacity-50',
        )}
      >
        <div className="flex items-center gap-2">
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', accent.chip)}>
            <Icon name={type?.icon ?? 'Hash'} size={16} />
          </span>
          <div className="min-w-0 flex-1">
            {!isDepartment && <div className="eyebrow break-words text-[10px]">{type?.label}</div>}
            <div className="break-words text-[13px] font-semibold text-ink-900">
              {isDepartment ? `Department of ${node.name}` : node.name}
            </div>
          </div>
        </div>

        {(!isDepartment && !isBranch) || node.status === 'archived' ? (
          <div className="flex items-center gap-1.5">
            {!isDepartment && !isBranch && <CodeChip code={node.code} />}
            {node.status === 'archived' && <span className="text-[10px] font-medium text-crimson">Archived</span>}
          </div>
        ) : null}

        {headNames && headNames.length > 0 && (
          <div className="break-words text-[11px] text-muted">
            <span className="font-medium text-ink-700">{headNames.length === 1 ? 'Head' : 'Heads'}:</span>{' '}
            {headNames.slice(0, 2).join(', ')}
            {headNames.length > 2 && ` +${headNames.length - 2}`}
          </div>
        )}

        {metaField && (
          <div className="break-words text-[11px] text-muted">
            <span className="font-medium text-ink-700">{metaField.label}:</span> {node.metadata[metaField.key]}
          </div>
        )}

        {canExpand && (
          <Tooltip
            label={expanded ? 'Collapse' : `Expand${childCountLabel ? ` (${childCountLabel})` : ''}`}
            side="bottom"
            className="absolute -bottom-3 left-1/2 -translate-x-1/2"
          >
            <button
              onClick={(e) => { e.stopPropagation(); onToggle() }}
              className={cn(
                // Visible circle stays 24px (unchanged look); `before:` grows the
                // actual hit area to the ≥44dp touch-target minimum without
                // shifting layout or the card's absolute positioning.
                'relative flex h-6 w-6 items-center justify-center rounded-full border bg-white text-muted shadow-sm transition-colors before:absolute before:-inset-2.5 before:content-[\'\'] hover:border-ink-600 hover:text-ink-900',
                expanded && 'border-ink-900 text-ink-900',
              )}
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
                <Icon name="ChevronDown" size={13} />
              </motion.span>
            </button>
          </Tooltip>
        )}

        {childLabel && addsEmployee && onSelectEmployee ? (
          <div className="absolute -right-3 -top-3 opacity-0 group-hover:opacity-100">
            <Menu
              trigger={({ toggle }) => (
                <button
                  onClick={(e) => { e.stopPropagation(); toggle() }}
                  aria-label="Add"
                  // Visible circle stays 28px; `before:` expands the hit area to
                  // ≥44dp without changing the visible affordance or its position.
                  className="relative flex h-7 w-7 items-center justify-center rounded-full border border-line bg-white text-muted shadow-sm transition-all before:absolute before:-inset-2 before:content-[''] hover:border-ink-900 hover:text-ink-900"
                >
                  <Icon name="Plus" size={14} />
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem icon={<Icon name="UserPlus" size={15} />} onClick={() => { close(); onAdd() }}>
                    Add employee
                  </MenuItem>
                  <MenuItem icon={<Icon name="Users" size={15} />} onClick={() => { close(); onSelectEmployee() }}>
                    Select employee
                  </MenuItem>
                  {realChildType && onAddChild && (
                    <MenuItem icon={<Icon name="GitBranch" size={15} />} onClick={() => { close(); onAddChild() }}>
                      Add {realChildType.label.toLowerCase()}
                    </MenuItem>
                  )}
                </>
              )}
            </Menu>
          </div>
        ) : childLabel && (
          <Tooltip label={`Add ${childLabel.toLowerCase()}`} side="left" className="absolute -right-3 -top-3 opacity-0 group-hover:opacity-100">
            <button
              onClick={(e) => { e.stopPropagation(); onAdd() }}
              aria-label={`Add ${childLabel.toLowerCase()}`}
              // Visible circle stays 28px; `before:` expands the hit area to
              // ≥44dp without changing the visible affordance or its position.
              className="relative flex h-7 w-7 items-center justify-center rounded-full border border-line bg-white text-muted shadow-sm transition-all before:absolute before:-inset-2 before:content-[''] hover:border-ink-900 hover:text-ink-900"
            >
              <Icon name="Plus" size={14} />
            </button>
          </Tooltip>
        )}
      </motion.div>
    )
  },
)
NodeCard.displayName = 'NodeCard'
