import { Icon } from '@/components/ui/Icon'
import type { HierNode } from '@/lib/types'

/** Breadcrumb trail for the Geography Explorer: India (root) followed by the
 *  drill chain down to the current selection. Every crumb except the last is
 *  clickable and jumps straight back to that level — the keyboard/mouse
 *  equivalent of the Back button, but able to skip multiple levels at once. */
export function GeoBreadcrumb({ root, trail, onSelect }: {
  root: HierNode | undefined
  trail: HierNode[]
  onSelect: (id: string | null) => void
}) {
  // `trail` (from useBreadcrumb) already starts with the country node once
  // something is selected. Before any selection it's empty, so fall back to
  // showing just the root by itself.
  const crumbs = trail.length > 0 ? trail : root ? [root] : []

  return (
    <nav className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]" aria-label="Geography breadcrumb">
      {crumbs.map((node, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <span key={node.id} className="flex items-center gap-1">
            {i > 0 && <Icon name="ChevronRight" size={12} className="shrink-0 text-line" />}
            <button
              type="button"
              disabled={isLast}
              onClick={() => onSelect(i === 0 ? null : node.id)}
              className={
                isLast
                  ? 'break-words font-semibold text-ink-900'
                  : 'break-words text-muted transition-colors hover:text-ink-900 hover:underline'
              }
            >
              {node.name}
            </button>
          </span>
        )
      })}
    </nav>
  )
}
