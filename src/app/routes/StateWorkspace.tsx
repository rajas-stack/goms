import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useStateNode } from '@/lib/api'
import { WorkspaceProvider, useWorkspace } from '@/features/workspace/context'
import { HierarchyCanvas, type CanvasView } from '@/features/canvas/HierarchyCanvas'
import { GeographyExplorer } from '@/features/geography/GeographyExplorer'
import { DetailsPanel } from '@/features/details/DetailsPanel'
import { Tabs } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { CodeChip } from '@/components/ui/Badge'

type View = CanvasView

const DETAILS_WIDTH_KEY = 'gorms:detailsPanelWidth'
const MIN_DETAILS_WIDTH = 320
const MAX_DETAILS_WIDTH = 640
const DEFAULT_DETAILS_WIDTH = 400

function readStoredDetailsWidth(): number {
  const raw = sessionStorage.getItem(DETAILS_WIDTH_KEY)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? Math.min(MAX_DETAILS_WIDTH, Math.max(MIN_DETAILS_WIDTH, n)) : DEFAULT_DETAILS_WIDTH
}

export function StateWorkspace() {
  const { code } = useParams()
  const stateCode = Number(code)
  const { data: stateNode, isLoading } = useStateNode(stateCode)
  const [view, setView] = useState<View>('org')
  const [detailsWidth, setDetailsWidth] = useState(readStoredDetailsWidth)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const resizeRafRef = useRef<number | null>(null)
  const resizeClientXRef = useRef(0)

  const onResizerPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startWidth: detailsWidth }
    // Prevents the canvas/details text from being selected mid-drag, which
    // otherwise swaps in a text-selection cursor and can leave the pointer
    // looking "stuck" once the drag crosses back onto the canvas.
    document.body.classList.add('select-none')
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [detailsWidth])
  const onResizerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    resizeClientXRef.current = e.clientX
    if (resizeRafRef.current != null) return
    resizeRafRef.current = requestAnimationFrame(() => {
      resizeRafRef.current = null
      if (!dragRef.current) return
      const delta = dragRef.current.startX - resizeClientXRef.current
      const next = Math.min(MAX_DETAILS_WIDTH, Math.max(MIN_DETAILS_WIDTH, dragRef.current.startWidth + delta))
      setDetailsWidth(next)
    })
  }, [])
  // Shared by pointerup AND lostpointercapture — capture can be revoked by
  // the browser mid-drag, and without this the resize state and cursor would
  // be left stuck indefinitely.
  const onResizerPointerUp = useCallback(() => {
    document.body.classList.remove('select-none')
    if (!dragRef.current) return
    dragRef.current = null
    if (resizeRafRef.current != null) {
      cancelAnimationFrame(resizeRafRef.current)
      resizeRafRef.current = null
    }
    setDetailsWidth((w) => { sessionStorage.setItem(DETAILS_WIDTH_KEY, String(w)); return w })
  }, [])

  if (isLoading) return null
  if (!stateNode) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted">No state found for code {code}.</p>
        <Link to="/map" className="text-sm font-medium text-teal-600 hover:underline">Back to the map</Link>
      </div>
    )
  }

  return (
    <WorkspaceProvider stateCode={stateCode}>
      <div className="flex h-full flex-col lg:flex-row">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-b border-line lg:border-b-0 lg:border-r">
          <WorkspaceHeader stateName={stateNode.name} stateCode={stateNode.code} view={view} onView={setView} />
          <div className="relative min-h-0 flex-1">
            {view === 'geo'
              ? <GeographyExplorer stateNodeId={stateNode.id} />
              : <HierarchyCanvas domain={view} stateCode={stateCode} />}
          </div>
        </div>

        <div
          onPointerDown={onResizerPointerDown}
          onPointerMove={onResizerPointerMove}
          onPointerUp={onResizerPointerUp}
          onPointerLeave={onResizerPointerUp}
          onLostPointerCapture={onResizerPointerUp}
          className="hidden w-1.5 shrink-0 touch-none cursor-col-resize items-center justify-center transition-colors hover:bg-ink-900/[0.06] lg:flex"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize details panel"
        >
          <span className="h-8 w-1 rounded-full bg-line" />
        </div>

        <aside style={{ width: detailsWidth }} className="hidden min-h-0 shrink-0 overflow-y-auto scrollbar-thin bg-paper lg:block">
          <DetailsPanel />
        </aside>

        <MobileDetailsSheet />
      </div>
    </WorkspaceProvider>
  )
}

export function MobileDetailsSheet() {
  const ws = useWorkspace()
  return (
    <AnimatePresence>
      {ws.selection && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 340, damping: 32 }}
          className="fixed inset-x-0 bottom-0 z-30 max-h-[75vh] overflow-hidden rounded-t-2xl border-t border-line bg-paper shadow-pop lg:hidden"
        >
          <Tooltip label="Close details" side="left" className="absolute right-3 top-3 z-10">
            <button
              onClick={ws.clearSelection}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-ink-900/[0.06] hover:text-ink"
              aria-label="Close details"
            >
              <Icon name="X" size={15} />
            </button>
          </Tooltip>
          <div className="max-h-[75vh] overflow-y-auto scrollbar-thin">
            <DetailsPanel />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function WorkspaceHeader({ stateName, stateCode, view, onView }: {
  stateName: string
  stateCode: string | null
  view: View
  onView: (v: View) => void
}) {
  const navigate = useNavigate()
  const ws = useWorkspace()

  return (
    <div className="z-10 flex flex-wrap items-center gap-3 border-b border-line bg-white/80 px-4 py-3 backdrop-blur">
      <Tooltip label="Back to the map" side="bottom">
        <button onClick={() => navigate('/map')} aria-label="Back to the map" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel hover:text-ink">
          <Icon name="ArrowLeft" size={15} />
        </button>
      </Tooltip>
      <div className="mr-1">
        <h1 className="truncate font-display text-[15px] font-semibold leading-tight text-ink-900">{stateName}</h1>
        <CodeChip code={stateCode} className="mt-0.5" />
      </div>

      <Tabs
        value={view}
        onChange={onView}
        tabs={[{ value: 'org', label: 'Organization' }, { value: 'geo', label: 'Geography' }, { value: 'people', label: 'People' }]}
      />

      {view === 'org' && (
        <Button size="sm" variant="primary" className="ml-auto" onClick={ws.createDepartment}>
          <Icon name="Plus" size={14} /> Department
        </Button>
      )}
    </div>
  )
}
