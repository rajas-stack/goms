import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { useBreadcrumb, useChildCounts, useChildren, useNode, useOrgRoots } from '@/lib/api'
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
export function OrgTargetPicker({ open, stateCode, title, requireChildType, pickLabel, onPick, onClose }: {
  open: boolean
  stateCode: number
  title: string
  requireChildType?: string
  pickLabel: (node: HierNode) => string
  onPick: (node: HierNode) => void
  onClose: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const atRoot = selectedId === null

  const { data: orgRoots = [] } = useOrgRoots(stateCode)
  const { data: current } = useNode(selectedId)
  const { data: trail = [] } = useBreadcrumb(selectedId)
  const { data: children = [] } = useChildren(selectedId)
  const { data: counts = {} } = useChildCounts(selectedId)

  const items = atRoot ? orgRoots : children
  const currentType = current ? NODE_TYPE_MAP[current.typeKey] : undefined

  function canPick(node: HierNode): boolean {
    return requireChildType ? childTypesOf(node.typeKey).some((t) => t.key === requireChildType) : true
  }

  function back() {
    if (trail.length >= 2) setSelectedId(trail[trail.length - 2].id)
    else setSelectedId(null)
  }

  function close() {
    setSelectedId(null)
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} title={title} size="lg">
      <div className="flex h-[28rem] max-h-[65vh] flex-col overflow-hidden rounded-card border border-line">
        <div className="z-10 flex flex-wrap items-center gap-3 border-b border-line bg-panel/40 px-3 py-2.5">
          <Tooltip label="Back one level" side="bottom">
            <button
              onClick={back}
              disabled={atRoot}
              aria-label="Back one level"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-white hover:text-ink disabled:opacity-30 disabled:pointer-events-none"
            >
              <Icon name="ArrowLeft" size={15} />
            </button>
          </Tooltip>

          <nav className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]" aria-label="Organization breadcrumb">
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              disabled={atRoot}
              className={cn('truncate', atRoot ? 'font-semibold text-ink-900' : 'text-muted transition-colors hover:text-ink-900 hover:underline')}
            >
              Departments
            </button>
            {trail.map((t, i) => {
              const isLast = i === trail.length - 1
              return (
                <span key={t.id} className="flex items-center gap-1">
                  <Icon name="ChevronRight" size={12} className="shrink-0 text-line" />
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    disabled={isLast}
                    className={cn('truncate', isLast ? 'font-semibold text-ink-900' : 'text-muted transition-colors hover:text-ink-900 hover:underline')}
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
            onSelect={(node) => setSelectedId(node.id)}
            onAdd={(node) => { onPick(node); close() }}
            canAdd={canPick}
            addLabel={pickLabel}
          />
          {/* The tile grid above only offers picking a CHILD of the node
             *  currently being browsed — this is the only way to pick the
             *  node you've just drilled INTO (there's no single virtual
             *  "root" tile for it once you're past the Departments crossroads,
             *  same reasoning as OrganizationList's own drill model). */}
          {current && canPick(current) && (
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
