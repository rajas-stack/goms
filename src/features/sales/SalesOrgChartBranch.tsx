import { useLayoutEffect, useRef } from 'react'
import { useCanvas } from '@/features/canvas/canvasContext'
import { useWorkspace } from '@/features/workspace/context'
import { SalesOrgChartCard } from './SalesOrgChartCard'
import { useSalesDetailsSidebar } from './SalesDetailsSidebar'
import type { SalesOrgTree } from './salesHierarchyTree'
import type { SalesPerson, SalesPosting } from '@/lib/types'

export function SalesOrgChartBranch({ person, depth, parentKey, tree, postings, ws }: {
  person: SalesPerson
  depth: number
  parentKey: string | null
  tree: SalesOrgTree
  postings: Record<string, SalesPosting>
  ws: ReturnType<typeof useWorkspace>
}) {
  const canvas = useCanvas()
  const details = useSalesDetailsSidebar()
  const key = `sp:${person.id}`
  const kids = tree.childrenOf.get(person.id) ?? []
  const expanded = canvas.isExpanded(key, depth)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    canvas.setCardRef(key, ref.current)
    if (parentKey) canvas.setParent(key, parentKey)
    return () => {
      canvas.setCardRef(key, null)
      if (parentKey) canvas.clearParent(key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, parentKey])

  return (
    <div className="flex flex-col items-center">
      <SalesOrgChartCard
        ref={ref}
        person={person}
        posting={postings[person.id]}
        flagged={tree.flaggedRootIds.has(person.id)}
        selected={ws.selection?.kind === 'salesPerson' && ws.selection.id === person.id}
        expanded={expanded}
        canExpand={kids.length > 0}
        directReportCount={kids.length}
        onSelect={() => { ws.select('salesPerson', person.id); details.reveal() }}
        onToggle={() => canvas.setNodeExpanded(key, depth, !expanded)}
      />
      {expanded && kids.length > 0 && (
        <div className="mt-8 flex items-start gap-8">
          {kids.map((k) => (
            <SalesOrgChartBranch key={k.id} person={k} depth={depth + 1} parentKey={key} tree={tree} postings={postings} ws={ws} />
          ))}
        </div>
      )}
    </div>
  )
}
