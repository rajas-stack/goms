import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'
import type { HierNode } from '@/lib/types'

/** District/Taluka/Village levels have no boundary geometry anywhere in this
 *  project, so they're deliberately rendered as a grid of named, clickable
 *  tiles rather than fake polygons that would imply false geographic
 *  precision. Every tile shows the entity's name and (where meaningful) how
 *  many of its own children it has.
 *
 *  Deliberately NOT using `@tanstack/react-virtual`'s grid-aware windowing
 *  here (unlike `Meetings`/`PeopleDirectory`) — this grid is responsive
 *  (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`), and every call site owns a
 *  different scroll container (`OrganizationList`'s own div, Geography's
 *  `TilePane`, the small `FallbackTiles` strip), so true virtualization would
 *  need a column-count-aware size model threaded through several unrelated
 *  parents to recompute row height × dynamic column count on every resize —
 *  real complexity and regression risk for a grid whose seed data (see
 *  `src/data/gov-hierarchy.ts`) tops out in the low hundreds of items, never
 *  tens of thousands. `content-visibility: auto` gets most of the same
 *  render-cost win (skips layout/paint for off-screen tiles) for near-zero
 *  risk, so that's what's applied per-tile below instead. */
export function EntityGrid({ items, counts, countNoun, icon, getIcon, emptyMessage, onSelect, onAdd, addLabel, canAdd, emptyAction }: {
  items: HierNode[]
  /** child id → count of ITS active children (from `useChildCounts`). */
  counts: Record<string, number>
  /** Label for the count line, e.g. "taluka" / "village". Pass `null` to omit
   *  the count line entirely — villages are leaves, so a "0 somethings" count
   *  under a village tile would be meaningless rather than merely zero. */
  countNoun: string | null
  /** Grid-wide fallback icon — used for the empty-state icon, and per-tile
   *  whenever `getIcon` is omitted or returns nothing. Geography's siblings
   *  are always one type (all districts, all talukas, …), so its 4 call
   *  sites just pass this and skip `getIcon`. */
  icon: string
  /** Optional per-tile icon resolver — needed wherever siblings can be a MIX
   *  of node types (e.g. Organization: a Branch's children can be branches,
   *  divisions, and offices together, each with its own icon in Canvas'
   *  `NodeCard`). Falls back to `icon` when it returns nothing so a caller
   *  can resolve icons for known types only. */
  getIcon?: (item: HierNode) => string | undefined
  emptyMessage: string
  /** Omit for a leaf level with nowhere to drill into (villages) — tiles
   *  render as plain, non-interactive name cards instead of buttons. */
  onSelect?: (node: HierNode) => void
  /** Optional secondary "+" affordance per tile — mirrors the canvas card's
   *  own onAdd (add a child / add an employee). Omit for domains/levels with
   *  no such action (e.g. geography, which has none of these). Always shown
   *  (not hover-only) since these grids are the touch-first list surfaces. */
  onAdd?: (node: HierNode) => void
  /** Accessible label for the "+" button, e.g. "Add employee" / "Add branch". */
  addLabel?: (node: HierNode) => string
  /** Per-tile gate on the "+" button, e.g. the global FAB's org target picker
   *  only wants a "+" on nodes that can actually have the desired child type.
   *  Defaults to true (current behavior) whenever `onAdd` is passed without it. */
  canAdd?: (node: HierNode) => boolean
  /** Optional action rendered inside the empty state itself (e.g. the FAB's
   *  org picker offering "Add X here" for the node just drilled into) — shown
   *  centered alongside the empty message instead of pinned below the grid,
   *  since there's no grid left to pin it under once `items` is empty. */
  emptyAction?: ReactNode
}) {
  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line bg-white/60 p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-panel text-muted">
          <Icon name={icon} size={20} />
        </div>
        <p className="max-w-xs text-sm font-medium text-ink-900">{emptyMessage}</p>
        <p className="text-xs text-muted">Use the breadcrumb or Back button to explore elsewhere.</p>
        {emptyAction}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((node, i) => {
        const count = counts[node.id] ?? 0
        const tileIcon = getIcon?.(node) ?? icon
        const showAdd = !!onAdd && (canAdd?.(node) ?? true)
        return (
          // A plain `<button>` can't host the nested "+" button (invalid HTML,
          // interactive-in-interactive), so this is a div playing the button
          // role — same click/keyboard contract, `onAdd` just needs somewhere
          // to live alongside it.
          <motion.div
            key={node.id}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onClick={onSelect ? () => onSelect(node) : undefined}
            onKeyDown={onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(node) } } : undefined}
            aria-disabled={!onSelect}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.02, 0.3), duration: 0.25 }}
            className={cn(
              'group relative flex flex-col items-start gap-2 rounded-card border border-line bg-white p-3.5 text-left transition-colors',
              onSelect
                ? 'cursor-pointer hover:border-ink-600 hover:bg-panel/60 focus-visible:focus-ring'
                : 'cursor-default',
            )}
          >
            <div
              className={cn(
                // `w-full min-w-0`: this div is itself a flex item of the
                // tile above (`items-start`), so without an explicit width it
                // shrink-wraps to its children's max-content size (the full,
                // untruncated name) instead of the tile's actual (grid-track-
                // constrained) width — the name span's own `w-full` further
                // down can only resolve against ITS parent's width if that
                // parent has one, so the constraint has to start here too.
                'flex w-full min-w-0 flex-col items-start gap-2',
                // Skip layout/paint for tiles currently scrolled out of view —
                // a cheap, browser-native stand-in for full grid virtualization
                // at this component's realistic (low-hundreds) list sizes; see
                // the component doc comment above for the full judgment call.
                // Scoped to this inner wrapper (icon + name/count only) rather
                // than the tile itself: `content-visibility: auto` always
                // applies `contain: paint`, which clips descendants to the
                // containing box — the "+" button below overhangs the tile
                // edge (`-right-2 -top-2`) along with its tooltip and touch
                // hit-slop, so it must stay OUTSIDE the contained subtree or
                // paint containment would crop/hide all three.
                '[content-visibility:auto] [contain-intrinsic-size:0_120px]',
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-600">
                <Icon name={tileIcon} size={16} />
              </span>
              {/* `w-full`: this span's parent is a `flex-col items-start`
                 *  container, which shrink-wraps children to content width
                 *  instead of stretching them — without an explicit width,
                 *  the name below has no boundary to wrap against and would
                 *  overflow the tile instead. Wraps (no `truncate`) so the
                 *  full name is always visible, at the cost of a taller tile
                 *  for longer names. */}
              <span className="w-full min-w-0">
                <span className="block break-words font-display text-sm font-semibold text-ink-900">{node.name}</span>
                {countNoun && (
                  <span className="mt-0.5 block font-mono text-[11px] text-muted">
                    {count} {countNoun}{count === 1 ? '' : 's'}
                  </span>
                )}
              </span>
            </div>

            {/* The "+" overhangs the tile corner from `sm:` up; on a phone it's
                tucked inside instead, where the negative offsets widened the
                enclosing scroll container into a stray horizontal scrollbar. */}
            {showAdd && (
              <Tooltip label={addLabel?.(node) ?? 'Add'} side="top" className="absolute right-2 top-2 sm:-right-2 sm:-top-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onAdd(node) }}
                  aria-label={addLabel?.(node) ?? 'Add'}
                  // Visible circle stays 28px; `before:` expands the hit area to
                  // ≥44dp without changing the visible affordance or its position.
                  className="relative flex h-7 w-7 items-center justify-center rounded-full border border-line bg-white text-muted shadow-sm transition-colors before:absolute before:-inset-2 before:content-[''] hover:border-ink-900 hover:text-ink-900"
                >
                  <Icon name="Plus" size={14} />
                </button>
              </Tooltip>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}
