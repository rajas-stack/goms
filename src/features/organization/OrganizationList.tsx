import { useEffect, useRef, useState } from 'react'
import { useBreadcrumb, useChildCounts, useChildren, useNode, useOrgRoots } from '@/lib/api'
import { useWorkspace } from '@/features/workspace/context'
import { EntityGrid } from '@/features/geography/EntityGrid'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { NODE_TYPE_MAP } from '@/lib/node-types'
import { cn } from '@/lib/utils'
import type { HierNode } from '@/lib/types'

const EMPLOYEE_ADDERS = new Set(['department', 'branch', 'division', 'office', 'unit'])

function addsEmployee(node: HierNode): boolean {
  return node.domain === 'org' && EMPLOYEE_ADDERS.has(node.typeKey)
}

/** Organization list: a drill-down list of org-domain nodes for the current
 *  state, modeled on GeographyExplorer's state→district→… pattern and
 *  reusing the same `EntityGrid` tile grid. This is the list-mode sibling of
 *  the org `HierarchyCanvas` — same data, same `ws.*` actions, so switching
 *  between List and Canvas never changes what's selected or what an action
 *  does.
 *
 *  There's no single root org node (a state can have several departments),
 *  so the top of the drill is a virtual "Departments" crumb rather than a
 *  real node — everything below that is real `HierNode`s via `useChildren`. */
export function OrganizationList({ stateCode }: { stateCode: number }) {
  const ws = useWorkspace()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const atRoot = selectedId === null

  const { data: orgRoots = [] } = useOrgRoots(stateCode)
  const { data: current } = useNode(selectedId)
  const { data: trail = [] } = useBreadcrumb(selectedId)
  const { data: children = [] } = useChildren(selectedId)
  const { data: counts = {} } = useChildCounts(selectedId)

  const items = atRoot ? orgRoots : children
  const currentType = current ? NODE_TYPE_MAP[current.typeKey] : undefined

  // Selecting a tile both drills into it AND selects it via `ws.select`, so
  // the DetailsPanel (edit/move/delete/add/etc.) comes up exactly as it
  // would clicking the equivalent card on the canvas. `lastOwnSelectRef`
  // records ids WE pushed to `ws.select` ourselves, so the external-selection
  // sync effect below can tell "we just navigated here" apart from "something
  // else changed the selection" without re-triggering itself.
  const lastOwnSelectRef = useRef<string | null>(null)
  function drillAndSelect(node: HierNode) {
    ws.select('node', node.id)
    lastOwnSelectRef.current = node.id
    setSelectedId(node.id)
  }
  function goTo(id: string | null) {
    setSelectedId(id)
    if (id) {
      ws.select('node', id)
      lastOwnSelectRef.current = id
    }
  }
  function back() {
    if (trail.length >= 2) goTo(trail[trail.length - 2].id)
    else goTo(null)
  }

  // Canvas stays in sync with `ws.selection` from ANY source (header dialogs,
  // DetailsPanel's own "Children"/"Positions" links, search, another tab's
  // selection carrying over, …) because it renders the whole tree and just
  // highlights whichever card matches. List drills into one level at a time,
  // so it needs its own explicit sync: whenever the shared selection changes
  // to an org node in this state that ISN'T the id we last drilled to
  // ourselves, treat it exactly like a tile click — drill the browse position
  // to that node so the grid and the DetailsPanel never disagree about where
  // you are.
  const wsSelectedNodeId = ws.selection?.kind === 'node' ? ws.selection.id : null
  const { data: wsSelectedNode } = useNode(wsSelectedNodeId)
  useEffect(() => {
    if (!wsSelectedNode) return
    if (wsSelectedNode.domain !== 'org' || wsSelectedNode.stateCode !== stateCode) return
    if (wsSelectedNode.id === lastOwnSelectRef.current) return
    lastOwnSelectRef.current = wsSelectedNode.id
    setSelectedId(wsSelectedNode.id)
  }, [wsSelectedNode, stateCode])

  // Mirrors CanvasBranch's onAdd exactly: a leaf/employee-adder type adds an
  // employee directly; anything else creates a child node.
  function handleAdd(node: HierNode) {
    if (addsEmployee(node)) ws.addEmployee(node)
    else ws.createChild(node)
  }
  function addLabel(node: HierNode): string {
    if (addsEmployee(node)) return 'Add employee'
    const childKey = NODE_TYPE_MAP[node.typeKey]?.childKeys[0]
    const label = childKey ? NODE_TYPE_MAP[childKey]?.label : undefined
    return label ? `Add ${label.toLowerCase()}` : 'Add child'
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="z-10 flex flex-wrap items-center gap-3 border-b border-line bg-white/80 px-4 py-2.5">
        <Tooltip label="Back one level" side="bottom">
          <button
            onClick={back}
            disabled={atRoot}
            aria-label="Back one level"
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted before:absolute before:-inset-2 before:content-[''] hover:bg-panel hover:text-ink disabled:opacity-30 disabled:pointer-events-none"
          >
            <Icon name="ArrowLeft" size={15} />
          </button>
        </Tooltip>

        <nav className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]" aria-label="Organization breadcrumb">
          <button
            type="button"
            onClick={() => goTo(null)}
            disabled={atRoot}
            className={cn('break-words', atRoot ? 'font-semibold text-ink-900' : 'text-muted transition-colors hover:text-ink-900 hover:underline')}
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
                  onClick={() => goTo(t.id)}
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
          onSelect={drillAndSelect}
          onAdd={handleAdd}
          addLabel={addLabel}
        />
      </div>
    </div>
  )
}
