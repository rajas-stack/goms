import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { CanvasProvider, elbowPath, useCanvas, type Edge } from '@/features/canvas/canvasContext'
import { useWorkspace } from '@/features/workspace/context'
import { useCurrentPostings, useSalesPersons } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { buildSalesOrgTree } from './salesHierarchyTree'
import { SalesOrgChartBranch } from './SalesOrgChartBranch'

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-panel text-muted">
        <Icon name={icon} size={18} />
      </div>
      <p className="text-sm text-muted">{message}</p>
    </div>
  )
}

export function SalesOrgChartCanvas() {
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  return (
    <CanvasProvider onChange={bump}>
      <SalesOrgChartStage version={version} />
    </CanvasProvider>
  )
}

function SalesOrgChartStage({ version }: { version: number }) {
  const canvas = useCanvas()
  const ws = useWorkspace()
  const { data: people = [], isLoading } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()
  const contentRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState<Edge[]>([])

  const tree = buildSalesOrgTree(people, postings)

  const recompute = useCallback(() => {
    setEdges(canvas.computeEdges(contentRef.current))
  }, [canvas])

  useLayoutEffect(() => { recompute() }, [version, recompute, tree.roots.length])
  useLayoutEffect(() => {
    if (!contentRef.current) return
    const ro = new ResizeObserver(() => recompute())
    ro.observe(contentRef.current)
    return () => ro.disconnect()
  }, [recompute])

  if (isLoading) return <p className="px-4 py-6 text-sm text-muted">Loading org chart…</p>
  if (people.length === 0) {
    return <EmptyState icon="Network" message="No sales people yet — add your first one from the Roster tab." />
  }

  return (
    <div className="relative flex h-full w-full flex-col" data-testid="sales-org-chart">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-line bg-white/90 px-3 py-1.5">
        <Tooltip label="Expand all branches">
          <button
            onClick={() => canvas.setAllExpanded(true)}
            className="flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-ink-600 hover:bg-panel hover:text-ink-900"
          >
            <Icon name="ChevronsDown" size={13} /> Expand all
          </button>
        </Tooltip>
        <Tooltip label="Collapse all branches">
          <button
            onClick={() => canvas.setAllExpanded(false)}
            className="flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-ink-600 hover:bg-panel hover:text-ink-900"
          >
            <Icon name="ChevronsUp" size={13} /> Collapse all
          </button>
        </Tooltip>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto p-6">
        <div ref={contentRef} className="relative inline-flex items-start gap-8">
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
            {edges.map((e) => (
              <path key={e.key} d={elbowPath(e)} fill="none" stroke="#B7C2D0" strokeWidth={1.5} />
            ))}
          </svg>
          {tree.roots.map((person) => (
            <SalesOrgChartBranch
              key={person.id}
              person={person}
              // Deliberately not 0: `useCanvas().isExpanded` special-cases
              // depth 0 as "default open" (right for HierarchyCanvas's
              // handful-of-departments root level, shared unmodified from
              // Task 1) — but a sales org's roots can be numerous senior
              // people, so this tree defaults every level closed until
              // "Expand all" or a per-card toggle says otherwise. Offsetting
              // by one avoids ever hitting that depth-0 special case without
              // touching the shared canvasContext.
              depth={1}
              parentKey={null}
              tree={tree}
              postings={postings}
              ws={ws}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
