import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { useChildCounts, useChildren, useOrgRoots } from '@/lib/api'
import { NODE_TYPE_MAP, childTypesOf } from '@/lib/node-types'
import { EntityGrid } from '@/features/geography/EntityGrid'
import { cn } from '@/lib/utils'
import type { HierNode } from '@/lib/types'

/** Picker-mode sibling of `OrganizationList`: same state→department→…
 *  drill-down (`useOrgRoots`/`useChildren`/`useBreadcrumb`) and the same
 *  `EntityGrid` tile rendering, but selecting a tile calls `onPick(node)`
 *  instead of `ws.select(...)` — there's no workspace mounted yet for the
 *  global FAB to select into. Used by the FAB for:
 *   - "Create Person": any org node is a valid posting (`requireChildType`
 *     omitted), so every tile shows the pick affordance.
 *   - "Create Branch/Division/Office/Unit": `requireChildType` is the target
 *     type key (e.g. 'office') — only nodes whose `childTypesOf` actually
 *     includes it (the same lookup `NodeCard`'s "+" uses) show the pick
 *     affordance, so the resulting `NodeFormDialog` never opens on a parent
 *     that can't structurally hold the intended type. Nodes that don't
 *     qualify are still drillable, since the qualifying node might be one of
 *     their descendants. */
export function OrgTargetPicker({ open, stateCode, title, requireChildType, pickLabel, onPick, onClose, onBackToState }: {
  open: boolean
  stateCode: number
  title: string
  requireChildType?: string
  pickLabel: (node: HierNode) => string
  onPick: (node: HierNode) => void
  onClose: () => void
  /** Steps back out to the FAB's state picker so a different state (not just
   *  a different department under this one) can be chosen — omit to keep the
   *  breadcrumb's root a dead end (e.g. a future non-FAB caller with no state
   *  picker to return to). Without this, drilling all the way down and
   *  backing all the way out had nowhere left to go once the root's own
   *  "Back one level" went disabled — this state's Departments root, forever. */
  onBackToState?: () => void
}) {
  // The drill-down path as an explicit stack, NOT derived from a
  // `useBreadcrumb` query. Every tile click already hands us the full
  // `HierNode`, so pushing it is both cheaper (no per-level node/breadcrumb
  // fetch) and — crucially — synchronous: `back()` used to read query data
  // that lagged the current selection by a render, so drilling in and
  // immediately pressing Back stepped up from the PREVIOUS node's trail and
  // skipped a level. A stack can't go stale.
  const [path, setPath] = useState<HierNode[]>([])
  const current = path.length > 0 ? path[path.length - 1] : null
  const selectedId = current?.id ?? null
  const atRoot = current === null

  const { data: orgRoots = [] } = useOrgRoots(stateCode)
  const { data: children = [] } = useChildren(selectedId)
  const { data: counts = {} } = useChildCounts(selectedId)

  // A reopen can bypass `close()` entirely — the FAB's back-button bridge
  // drops its flow state directly — so the path resets on open too, rather
  // than trusting every caller to have gone through `close()`.
  useEffect(() => {
    if (open) setPath([])
  }, [open, stateCode])

  const items = atRoot ? orgRoots : children
  const currentType = current ? NODE_TYPE_MAP[current.typeKey] : undefined

  function canPick(node: HierNode): boolean {
    return requireChildType ? childTypesOf(node.typeKey).some((t) => t.key === requireChildType) : true
  }

  function back() {
    if (atRoot) { onBackToState?.(); return }
    setPath((p) => p.slice(0, -1))
  }

  function close() {
    setPath([])
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} title={title} size="lg">
      <div className="flex h-[28rem] max-h-[65vh] flex-col overflow-hidden rounded-card border border-line">
        <div className="z-10 flex flex-wrap items-center gap-3 border-b border-line bg-panel/40 px-3 py-2.5">
          <Tooltip label={atRoot && onBackToState ? 'Change state' : 'Back one level'} side="bottom">
            <button
              onClick={back}
              disabled={atRoot && !onBackToState}
              aria-label={atRoot && onBackToState ? 'Change state' : 'Back one level'}
              className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted before:absolute before:-inset-2 before:content-[''] hover:bg-white hover:text-ink disabled:opacity-30 disabled:pointer-events-none"
            >
              <Icon name="ArrowLeft" size={15} />
            </button>
          </Tooltip>

          <nav className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]" aria-label="Organization breadcrumb">
            <button
              type="button"
              onClick={() => setPath([])}
              disabled={atRoot}
              className={cn('break-words', atRoot ? 'font-semibold text-ink-900' : 'text-muted transition-colors hover:text-ink-900 hover:underline')}
            >
              Departments
            </button>
            {path.map((t, i) => {
              const isLast = i === path.length - 1
              return (
                <span key={t.id} className="flex items-center gap-1">
                  <Icon name="ChevronRight" size={12} className="shrink-0 text-line" />
                  <button
                    type="button"
                    onClick={() => setPath((p) => p.slice(0, i + 1))}
                    disabled={isLast}
                    className={cn('break-words', isLast ? 'font-semibold text-ink-900' : 'text-muted transition-colors hover:text-ink-900 hover:underline')}
                  >
                    {t.name}
                  </button>
                </span>
              )
            })}
          </nav>

          <span className="ml-auto shrink-0 text-[12px] text-muted">
            <span className="eyebrow mr-1.5">{atRoot ? 'Department' : currentType?.label ?? 'Node'}</span>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-4">
          <EntityGrid
            items={items}
            counts={atRoot ? {} : counts}
            countNoun={atRoot ? null : 'item'}
            icon="Building2"
            getIcon={(node) => NODE_TYPE_MAP[node.typeKey]?.icon}
            emptyMessage={atRoot ? 'No departments recorded yet for this state.' : `${current?.name ?? 'This node'} has no children yet.`}
            onSelect={(node) => setPath((p) => [...p, node])}
            onAdd={(node) => { onPick(node); close() }}
            canAdd={canPick}
            addLabel={pickLabel}
            emptyAction={current && canPick(current) && (
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => { onPick(current); close() }}
                  aria-label={pickLabel(current)}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-600 text-white shadow-sm transition-colors hover:bg-teal-700"
                >
                  <Icon name="Plus" size={28} />
                </button>
                <span className="text-xs text-muted">{pickLabel(current)}</span>
              </div>
            )}
          />
          {/* The tile grid above only offers picking a CHILD of the node
             *  currently being browsed — this is the only way to pick the
             *  node you've just drilled INTO (there's no single virtual
             *  "root" tile for it once you're past the Departments crossroads,
             *  same reasoning as OrganizationList's own drill model). Only
             *  needed here when there ARE still children to show; once
             *  `items` is empty, `EntityGrid`'s `emptyAction` above already
             *  renders this same affordance centered in the empty state. */}
          {items.length > 0 && current && canPick(current) && (
            <button
              type="button"
              onClick={() => { onPick(current); close() }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-[13px] font-medium text-teal-600 hover:border-teal-600 hover:bg-teal-100/40"
            >
              <Icon name="Plus" size={14} /> {pickLabel(current)}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
