import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import type { HierNode } from '@/lib/types'

/** District/Taluka/Village levels have no boundary geometry anywhere in this
 *  project, so they're deliberately rendered as a grid of named, clickable
 *  tiles rather than fake polygons that would imply false geographic
 *  precision. Every tile shows the entity's name and (where meaningful) how
 *  many of its own children it has. */
export function EntityGrid({ items, counts, countNoun, icon, emptyMessage, onSelect }: {
  items: HierNode[]
  /** child id → count of ITS active children (from `useChildCounts`). */
  counts: Record<string, number>
  /** Label for the count line, e.g. "taluka" / "village". Pass `null` to omit
   *  the count line entirely — villages are leaves, so a "0 somethings" count
   *  under a village tile would be meaningless rather than merely zero. */
  countNoun: string | null
  icon: string
  emptyMessage: string
  /** Omit for a leaf level with nowhere to drill into (villages) — tiles
   *  render as plain, non-interactive name cards instead of buttons. */
  onSelect?: (node: HierNode) => void
}) {
  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line bg-white/60 p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-panel text-muted">
          <Icon name={icon} size={20} />
        </div>
        <p className="max-w-xs text-sm font-medium text-ink-900">{emptyMessage}</p>
        <p className="text-xs text-muted">Use the breadcrumb or Back button to explore elsewhere.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((node, i) => {
        const count = counts[node.id] ?? 0
        return (
          <motion.button
            key={node.id}
            type="button"
            onClick={onSelect ? () => onSelect(node) : undefined}
            disabled={!onSelect}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.02, 0.3), duration: 0.25 }}
            className={cn(
              'flex flex-col items-start gap-2 rounded-card border border-line bg-white p-3.5 text-left transition-colors',
              onSelect
                ? 'cursor-pointer hover:border-ink-600 hover:bg-panel/60 focus-visible:focus-ring'
                : 'cursor-default',
            )}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-100 text-teal-600">
              <Icon name={icon} size={16} />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-display text-sm font-semibold text-ink-900">{node.name}</span>
              {countNoun && (
                <span className="mt-0.5 block font-mono text-[11px] text-muted">
                  {count} {countNoun}{count === 1 ? '' : 's'}
                </span>
              )}
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}
