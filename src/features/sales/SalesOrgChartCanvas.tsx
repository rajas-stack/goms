import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CanvasProvider, elbowPath, useCanvas, type Edge } from '@/features/canvas/canvasContext'
import { useCanvasViewport } from '@/features/canvas/useCanvasViewport'
import { CanvasControls } from '@/features/canvas/CanvasControls'
import { KeyboardShortcutsDialog, type CanvasShortcut } from '@/features/canvas/KeyboardShortcutsDialog'
import { useWorkspace } from '@/features/workspace/context'
import { useCurrentPostings, useSalesPersons } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { cn, isTypingTarget } from '@/lib/utils'
import { buildSalesOrgTree } from './salesHierarchyTree'
import { SalesOrgChartBranch } from './SalesOrgChartBranch'

// A deliberately smaller set than the Organization/People/Geo canvas's full
// list (`KeyboardShortcutsDialog`'s default): the Sales Org Chart has no
// arrow-key card navigation, no delete-selected, and no search — only what
// the toolbar below actually does.
const SALES_SHORTCUTS: CanvasShortcut[] = [
  { keys: 'F', action: 'Fit to screen' },
  { keys: '+ / =', action: 'Zoom in' },
  { keys: '−', action: 'Zoom out' },
  { keys: '0', action: 'Reset view' },
  { keys: 'E', action: 'Expand all' },
  { keys: 'C', action: 'Collapse all' },
  { keys: '?', action: 'Show this dialog' },
]

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
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const viewport = useCanvasViewport(viewportRef, contentRef)
  const { transform, dragging, userInteractedRef } = viewport
  const [edges, setEdges] = useState<Edge[]>([])
  // Connectors are always computed (cheap) but only drawn when this is on —
  // a "show/hide connectors" toggle the shared HierarchyCanvas toolbar has
  // no equivalent of, since it never hides its own lines; this is the one
  // genuinely new piece the Sales Org Chart's toolbar needs.
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

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

  // Keep auto-centering as the tree grows (async data loading in, or a
  // branch expanding) until the user manually pans/zooms — same rule as
  // HierarchyCanvas's own auto-follow effect, just without a
  // domain/department axis to key on (there's only ever one tree here).
  useLayoutEffect(() => {
    if (userInteractedRef.current) return
    viewport.centerView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tree.roots.length, viewport.centerView])

  function expandAll() {
    userInteractedRef.current = true
    canvas.setAllExpanded(true)
  }
  function collapseAll() {
    userInteractedRef.current = true
    canvas.setAllExpanded(false)
  }
  function resetView() {
    viewport.resetView()
    recompute()
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case '?':
          e.preventDefault(); setShortcutsOpen(true); break
        case 'f': case 'F':
          e.preventDefault(); viewport.fitToScreen(); break
        case '+': case '=':
          e.preventDefault(); viewport.zoomBy(1 / 0.85); break
        case '-': case '_':
          e.preventDefault(); viewport.zoomBy(0.85); break
        case '0':
          e.preventDefault(); resetView(); break
        case 'e': case 'E':
          e.preventDefault(); expandAll(); break
        case 'c': case 'C':
          e.preventDefault(); collapseAll(); break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (isLoading) return <p className="px-4 py-6 text-sm text-muted">Loading org chart…</p>
  if (people.length === 0) {
    return <EmptyState icon="Network" message="No sales people yet — add your first one from the Roster tab." />
  }

  return (
    <div
      ref={viewportRef}
      data-testid="sales-org-chart"
      className={cn(
        // `select-none` here (not just on <body> during a pan) is essential:
        // a press that begins on a card bails out of onPointerDown before the
        // pan guard runs, so without this a drag off a card onto the grid
        // would start a native text selection and swap the grab cursor for
        // an I-beam — same reasoning as HierarchyCanvas's identical class.
        'survey-grid relative h-full w-full touch-none select-none overflow-hidden',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
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
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: '0 0',
        }}
      >
        <svg data-testid="sales-org-chart-connectors" className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
          {edges.map((e) => (
            <path key={e.key} d={elbowPath(e)} fill="none" className="stroke-edge" strokeWidth={1.5} />
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

      <CanvasControls
        scale={transform.scale}
        onFit={viewport.fitToScreen}
        onZoomOut={() => viewport.zoomBy(0.85)}
        onZoomIn={() => viewport.zoomBy(1 / 0.85)}
        onReset={resetView}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />

      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        shortcuts={SALES_SHORTCUTS}
        footnote="The canvas is always in pan mode — drag any empty area to move around. Cards can't be dragged to reassign a manager."
      />
    </div>
  )
}
