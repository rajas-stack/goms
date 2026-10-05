import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CanvasProvider, elbowPath, useCanvas, type Edge } from '@/features/canvas/canvasContext'
import { useCanvasViewport } from '@/features/canvas/useCanvasViewport'
import { CanvasControls } from '@/features/canvas/CanvasControls'
import { Avatar } from '@/components/ui/Avatar'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { useDeliveryTeamMembers } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { DeliveryTeamKey } from '@/lib/types'

/** Anyone drawable on an org chart: a delivery-team member or an Org Structure person. */
export interface ChartPerson {
  id: string
  name: string
  designation: string
  managerId: string | null
  status: 'active' | 'inactive'
  email?: string
  photoUrl?: string | null
  /** Org level (L0 = top), shown as a badge when present. */
  level?: number
}

interface DeliveryOrgTree {
  roots: ChartPerson[]
  childrenOf: Map<string, ChartPerson[]>
}

/** Roots are members with no manager (or a manager not on this team). Anyone
 *  unreachable from a root — only possible with a corrupt circular chain —
 *  is promoted to a root rather than silently dropped. */
export function buildDeliveryOrgTree(members: ChartPerson[]): DeliveryOrgTree {
  const ids = new Set(members.map((member) => member.id))
  const childrenOf = new Map<string, ChartPerson[]>()
  const roots: ChartPerson[] = []
  for (const member of members) {
    if (member.managerId && ids.has(member.managerId) && member.managerId !== member.id) {
      childrenOf.set(member.managerId, [...(childrenOf.get(member.managerId) ?? []), member])
    } else {
      roots.push(member)
    }
  }
  const reached = new Set<string>()
  const visit = (member: ChartPerson) => {
    if (reached.has(member.id)) return
    reached.add(member.id)
    for (const child of childrenOf.get(member.id) ?? []) visit(child)
  }
  roots.forEach(visit)
  const orphans = members.filter((member) => !reached.has(member.id))
  return { roots: [...roots, ...orphans], childrenOf }
}

const OrgCard = forwardRef<HTMLDivElement, {
  member: ChartPerson
  reportCount: number
  expanded: boolean
  onToggle: () => void
}>(({ member, reportCount, expanded, onToggle }, ref) => (
  <div
    ref={ref}
    data-canvas-card
    className={cn(
      'relative flex w-[200px] flex-col items-center gap-2 rounded-card border border-line bg-white px-3.5 py-3 text-center shadow-panel',
      member.status === 'inactive' && 'opacity-60',
    )}
  >
    {member.level !== undefined && (
      <span className="absolute left-2 top-2 rounded-md bg-goms-navy/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-goms-navy">L{member.level}</span>
    )}
    <Avatar person={{ name: member.name, photoUrl: member.photoUrl }} size="md" />
    <div className="w-full min-w-0">
      <div className="truncate text-[13px] font-semibold text-ink-900">{member.name}</div>
      <div className="truncate text-[11px] text-muted">{member.designation || '—'}</div>
      {member.email && <div className="truncate text-[10px] text-muted/80">{member.email}</div>}
    </div>
    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', member.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-panel text-muted')}>
      {member.status === 'active' ? 'Active' : 'Inactive'}
    </span>
    {reportCount > 0 && (
      <Tooltip label={expanded ? 'Collapse' : `Show ${reportCount} direct report${reportCount === 1 ? '' : 's'}`}>
        <button
          onClick={(event) => { event.stopPropagation(); onToggle() }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className={cn(
            'absolute -bottom-3 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border bg-white text-muted shadow-sm hover:border-ink-600 hover:text-ink-900',
            expanded && 'border-ink-600 text-ink-900',
          )}
        >
          <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={13} />
        </button>
      </Tooltip>
    )}
  </div>
))
OrgCard.displayName = 'OrgCard'

function Branch({ member, depth, parentKey, tree }: { member: ChartPerson; depth: number; parentKey: string | null; tree: DeliveryOrgTree }) {
  const canvas = useCanvas()
  const key = `dt:${member.id}`
  const kids = tree.childrenOf.get(member.id) ?? []
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
      <OrgCard ref={ref} member={member} reportCount={kids.length} expanded={expanded} onToggle={() => canvas.setNodeExpanded(key, depth, !expanded)} />
      {expanded && kids.length > 0 && (
        <div className="mt-8 flex items-start gap-8">
          {kids.map((kid) => <Branch key={kid.id} member={kid} depth={depth + 1} parentKey={key} tree={tree} />)}
        </div>
      )}
    </div>
  )
}

/** Team org chart for Pre-sales / Legal / Bid — same pan/zoom canvas and
 *  card language as the Sales Org Chart, driven by `managerId` (reports-to). */
export function DeliveryOrgChart({ team }: { team: DeliveryTeamKey }) {
  const { data: members = [], isLoading } = useDeliveryTeamMembers(team)
  return (
    <PeopleOrgChart
      people={members.filter((member) => member.status === 'active')} isLoading={isLoading}
      emptyMessage="No one on this team yet — add people in Teams → Org Structure."
    />
  )
}

/** Pan/zoom org chart for any list of people linked by `managerId`. */
export function PeopleOrgChart(props: { people: ChartPerson[]; isLoading?: boolean; emptyMessage: string }) {
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  return (
    <CanvasProvider onChange={bump}>
      <Stage {...props} version={version} />
    </CanvasProvider>
  )
}

function Stage({ people: members, isLoading = false, emptyMessage, version }: { people: ChartPerson[]; isLoading?: boolean; emptyMessage: string; version: number }) {
  const canvas = useCanvas()
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const viewport = useCanvasViewport(viewportRef, contentRef)
  const { transform, dragging, userInteractedRef } = viewport
  const [edges, setEdges] = useState<Edge[]>([])
  const tree = buildDeliveryOrgTree(members)

  // Delivery teams are small — open the whole chart by default.
  useEffect(() => { canvas.setAllExpanded(true) }, [canvas.setAllExpanded])

  const recompute = useCallback(() => setEdges(canvas.computeEdges(contentRef.current)), [canvas])
  useLayoutEffect(() => { recompute() }, [version, recompute, members])
  useLayoutEffect(() => {
    if (!contentRef.current) return
    const observer = new ResizeObserver(() => recompute())
    observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [recompute, isLoading, members.length])
  useLayoutEffect(() => {
    if (userInteractedRef.current) return
    viewport.centerView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, members.length, viewport.centerView])

  if (isLoading) return <p className="px-4 py-6 text-sm text-muted">Loading org chart…</p>
  if (members.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-panel text-muted"><Icon name="Network" size={18} /></div>
        <p className="text-sm text-muted">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div
      ref={viewportRef}
      className={cn('survey-grid relative h-full w-full touch-none select-none overflow-hidden', dragging ? 'cursor-grabbing' : 'cursor-grab')}
      onWheel={viewport.onWheel}
      onPointerDown={viewport.onPointerDown}
      onPointerMove={viewport.onPointerMove}
      onPointerUp={viewport.endPan}
      onPointerCancel={viewport.endPan}
      onLostPointerCapture={viewport.endPan}
    >
      <div
        ref={contentRef}
        className="relative inline-flex items-start gap-8"
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, transformOrigin: '0 0' }}
      >
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
          {edges.map((edge) => <path key={edge.key} d={elbowPath(edge)} fill="none" stroke="#B7C2D0" strokeWidth={1.5} />)}
        </svg>
        {tree.roots.map((member) => <Branch key={member.id} member={member} depth={1} parentKey={null} tree={tree} />)}
      </div>
      <CanvasControls
        scale={transform.scale}
        onFit={viewport.fitToScreen}
        onZoomOut={() => viewport.zoomBy(0.85)}
        onZoomIn={() => viewport.zoomBy(1 / 0.85)}
        onReset={() => { viewport.resetView(); recompute() }}
        onExpandAll={() => { userInteractedRef.current = true; canvas.setAllExpanded(true) }}
        onCollapseAll={() => { userInteractedRef.current = true; canvas.setAllExpanded(false) }}
      />
    </div>
  )
}
