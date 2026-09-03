import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useEmployeesByState, useStateNode } from '@/lib/api'
import { CENTRAL_STATE_CODE } from '@/data/gov-hierarchy'
import { WorkspaceProvider, useWorkspace } from '@/features/workspace/context'
import { HierarchyCanvas, type CanvasView } from '@/features/canvas/HierarchyCanvas'
import { GeographyExplorer } from '@/features/geography/GeographyExplorer'
import { OrganizationList } from '@/features/organization/OrganizationList'
import { PeopleDirectory } from '@/features/directory/PeopleDirectory'
import { DetailsPanel } from '@/features/details/DetailsPanel'
import { Tabs } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { CodeChip } from '@/components/ui/Badge'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'

type View = CanvasView
type DisplayMode = 'list' | 'canvas'

const DETAILS_WIDTH_KEY = 'gorms:detailsPanelWidth'
const MIN_DETAILS_WIDTH = 320
const MAX_DETAILS_WIDTH = 640
const DEFAULT_DETAILS_WIDTH = 400

/** The workspace's top-level tab set — Organization/Geography/People for a
 *  real state, Organization/People only for Central Ministries (it isn't a
 *  jurisdiction with its own geography). Exported as a pure function so the
 *  gating rule is unit-testable without rendering the full workspace tree. */
export function workspaceTabs(isCentral: boolean): { value: View; label: string }[] {
  return isCentral
    ? [{ value: 'org', label: 'Organization' }, { value: 'people', label: 'People' }]
    : [{ value: 'org', label: 'Organization' }, { value: 'geo', label: 'Geography' }, { value: 'people', label: 'People' }]
}

function readStoredDetailsWidth(): number {
  const raw = sessionStorage.getItem(DETAILS_WIDTH_KEY)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? Math.min(MAX_DETAILS_WIDTH, Math.max(MIN_DETAILS_WIDTH, n)) : DEFAULT_DETAILS_WIDTH
}

export function StateWorkspace() {
  const { code } = useParams()
  const stateCode = Number(code)
  const isCentral = stateCode === CENTRAL_STATE_CODE
  const { data: stateNode, isLoading } = useStateNode(stateCode)
  const [view, setViewRaw] = useState<View>('org')
  // Central Ministries has no real geography of its own — it isn't a state
  // jurisdiction — so the Geography tab is hidden for it entirely (UI/nav
  // rule only; the underlying geo data is untouched). This setter is the one
  // place `view` ever changes, so it's also the one place that has to guard
  // against landing on 'geo' here: the tab itself is omitted below, but
  // `view` is local component state, not URL-driven, so nothing else could
  // set it to 'geo' for this state either — this is a defensive backstop,
  // not a route/deep-link case that can currently happen.
  const setView = useCallback((v: View) => setViewRaw(isCentral && v === 'geo' ? 'org' : v), [isCentral])
  // Canvas on desktop (≥ lg) preserves the existing web behavior; List on
  // mobile suits touch better. Tracks the live breakpoint until the user
  // explicitly picks a mode via the toggle, at which point their choice
  // sticks regardless of viewport size.
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [displayModeOverride, setDisplayModeOverride] = useState<DisplayMode | null>(null)
  const displayMode: DisplayMode = displayModeOverride ?? (isDesktop ? 'canvas' : 'list')
  const [detailsWidth, setDetailsWidth] = useState(readStoredDetailsWidth)
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const resizeRafRef = useRef<number | null>(null)
  const resizeClientXRef = useRef(0)

  const onResizerPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startWidth: detailsWidth }
    setResizing(true)
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
  // Shared by pointerup, pointercancel AND lostpointercapture — capture can
  // be revoked by the browser mid-drag, and without this the resize state
  // and cursor would be left stuck indefinitely. Deliberately NOT wired to
  // pointerleave: capture is taken on pointerdown, so pointerup still fires
  // here even once the cursor has drifted past this 6px-wide divider —
  // ending on pointerleave made the resize die on virtually the first
  // mouse-move of any real drag.
  const onResizerPointerUp = useCallback(() => {
    document.body.classList.remove('select-none')
    setResizing(false)
    if (!dragRef.current) return
    dragRef.current = null
    if (resizeRafRef.current != null) {
      cancelAnimationFrame(resizeRafRef.current)
      resizeRafRef.current = null
    }
    setDetailsWidth((w) => { sessionStorage.setItem(DETAILS_WIDTH_KEY, String(w)); return w })
  }, [])

  // Hard fallback for gestures the browser never delivers a pointerup for
  // (alt-tab away mid-drag) — without this, the col-resize cursor and
  // <body>'s select-none lock can stay stuck indefinitely.
  useEffect(() => {
    if (!resizing) return
    window.addEventListener('blur', onResizerPointerUp)
    document.addEventListener('visibilitychange', onResizerPointerUp)
    return () => {
      window.removeEventListener('blur', onResizerPointerUp)
      document.removeEventListener('visibilitychange', onResizerPointerUp)
    }
  }, [resizing, onResizerPointerUp])

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
          <WorkspaceHeader
            stateName={stateNode.name}
            stateCode={stateNode.code}
            isCentral={isCentral}
            view={view}
            onView={setView}
            displayMode={displayMode}
            onDisplayMode={setDisplayModeOverride}
          />
          <div className="relative min-h-0 flex-1">
            {view === 'geo' && !isCentral ? (
              <GeographyExplorer stateNodeId={stateNode.id} />
            ) : displayMode === 'list' ? (
              view === 'org' ? <OrganizationList stateCode={stateCode} /> : <PeopleList stateCode={stateCode} />
            ) : (
              <HierarchyCanvas domain={view} stateCode={stateCode} />
            )}
          </div>
        </div>

        <div
          onPointerDown={onResizerPointerDown}
          onPointerMove={onResizerPointerMove}
          onPointerUp={onResizerPointerUp}
          onPointerCancel={onResizerPointerUp}
          onLostPointerCapture={onResizerPointerUp}
          className="hidden w-1.5 shrink-0 touch-none cursor-col-resize items-center justify-center transition-colors hover:bg-ink-900/[0.06] lg:flex"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize details panel"
        >
          <span className="h-8 w-1 rounded-full bg-line" />
        </div>

        <aside style={{ width: detailsWidth }} className="hidden min-h-0 shrink-0 overflow-y-auto scrollbar-thin bg-paper lg:block">
          <DetailsPanel floatingClose />
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
          // Sits ON TOP OF the mobile bottom nav rather than over it:
          // `bottom-14` matches SecondaryNav's `h-14`, so the Map/Directory/
          // Insights/Meetings bar stays visible and tappable the whole time a
          // record's details are open. z-[45] keeps it above the nav's own
          // z-40 stacking context but below real dialogs (z-50).
          className="fixed inset-x-0 bottom-14 z-[45] flex max-h-[70vh] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-paper shadow-pop lg:hidden"
        >
          {/* A dedicated strip for the drag handle + close button, separate
              from whatever the Details view below renders as its own header
              (avatar/name/Edit/⋯ for a person, etc.) — floating the ✕ over
              that content instead (as this used to) put it visually close to
              but misaligned with those buttons. */}
          <div className="relative flex shrink-0 items-center justify-center border-b border-line py-2.5">
            <span className="h-1 w-9 rounded-full bg-line" />
            <Tooltip label="Close details" side="left" className="absolute right-2 top-1/2 -translate-y-1/2">
              <button
                onClick={ws.clearSelection}
                className="relative flex h-7 w-7 items-center justify-center rounded-md text-muted before:absolute before:-inset-2 before:content-[''] hover:bg-ink-900/[0.06] hover:text-ink"
                aria-label="Close details"
              >
                <Icon name="X" size={15} />
              </button>
            </Tooltip>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            <DetailsPanel />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function WorkspaceHeader({ stateName, stateCode, isCentral, view, onView, displayMode, onDisplayMode }: {
  stateName: string
  stateCode: string | null
  /** Central Ministries isn't a real jurisdiction, so it has no geography of
   *  its own — hides the Geography tab for it (UI/nav only; the underlying
   *  geo data is untouched). */
  isCentral: boolean
  view: View
  onView: (v: View) => void
  displayMode: DisplayMode
  onDisplayMode: (m: DisplayMode) => void
}) {
  const navigate = useNavigate()
  const ws = useWorkspace()
  const showDisplayToggle = view === 'org' || view === 'people'
  const tabs = workspaceTabs(isCentral)

  return (
    <div className="z-20 flex flex-wrap items-center gap-3 border-b border-line bg-white/80 px-4 py-3">
      <Tooltip label="Back to the map" side="bottom">
        <button onClick={() => navigate('/map')} aria-label="Back to the map" className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted before:absolute before:-inset-2 before:content-[''] hover:bg-panel hover:text-ink">
          <Icon name="ArrowLeft" size={15} />
        </button>
      </Tooltip>
      <div className="mr-1">
        <h1 className="truncate font-display text-[15px] font-semibold leading-tight text-ink-900">{stateName}</h1>
        <CodeChip code={stateCode} className="mt-0.5" />
      </div>

      <Tabs value={view} onChange={onView} tabs={tabs} />

      {showDisplayToggle && <DisplayModeToggle value={displayMode} onChange={onDisplayMode} />}

      {view === 'org' && (
        <Button size="sm" variant="primary" className="ml-auto" onClick={ws.createDepartment}>
          <Icon name="Plus" size={14} /> Department
        </Button>
      )}
    </div>
  )
}

/** Small List/Canvas switch shown next to the tabs for the Organization and
 *  People tabs only — Geography stays canvas-less either way. Both modes
 *  read the same data and route every action through the same `ws.*`
 *  methods/DetailsPanel, so flipping this never changes selection or what
 *  an action does, only how the tree is browsed. */
function DisplayModeToggle({ value, onChange }: { value: DisplayMode; onChange: (m: DisplayMode) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-line bg-white p-0.5" role="group" aria-label="List or canvas view">
      {(['list', 'canvas'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          aria-pressed={value === mode}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium capitalize transition-colors',
            value === mode ? 'bg-ink-900 text-paper' : 'text-muted hover:text-ink-900',
          )}
        >
          <Icon name={mode === 'list' ? 'List' : 'Network'} size={13} />
          {mode}
        </button>
      ))}
    </div>
  )
}

/** Thin wrapper scoping the shared phonebook (`PeopleDirectory` — the same
 *  component `/directory` uses) to this state's employees. Zero new row
 *  code: search/filters/selection are all `PeopleDirectory`'s own. */
function PeopleList({ stateCode }: { stateCode: number }) {
  const { data: employees = [] } = useEmployeesByState(stateCode)
  return <PeopleDirectory employees={employees} />
}
