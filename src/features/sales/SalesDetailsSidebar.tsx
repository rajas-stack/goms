import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useWorkspace } from '@/features/workspace/context'
import { DetailsPanel } from '@/features/details/DetailsPanel'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { useMediaQuery } from '@/lib/useMediaQuery'

export const SIDEBAR_MIN = 320
export const SIDEBAR_MAX = 720
export const SIDEBAR_DEFAULT = 400
// Never let the details panel take more than this share of the workspace, so
// the roster/org chart stays usable on narrower desktops.
const MAX_SHARE = 0.6
const WIDTH_KEY = 'goms.sales.detailsWidth'

function readWidth(): number {
  try {
    const n = Number(sessionStorage.getItem(WIDTH_KEY))
    if (n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) return n
  } catch { /* storage unavailable */ }
  return SIDEBAR_DEFAULT
}

interface SidebarApi {
  /** Open the sidebar for the current selection (no-op when nothing is selected). */
  reveal: () => void
  /** Hide the sidebar without touching the selection. */
  hide: () => void
  open: boolean
  width: number
  setWidth: (w: number) => void
}

const noop = () => {}
const Ctx = createContext<SidebarApi>({ reveal: noop, hide: noop, open: false, width: SIDEBAR_DEFAULT, setWidth: noop })

/** Call from anything that selects a person/record so a previously closed
 *  sidebar slides back in — including re-clicking the already-selected card. */
export const useSalesDetailsSidebar = () => useContext(Ctx)

/** Owns the open/closed + width state. Closing only hides the panel: the
 *  workspace selection (and therefore the highlighted card and the
 *  `?sel=` deep link) is left untouched, so reopening restores the same person. */
export function SalesDetailsSidebarProvider({ children }: { children: ReactNode }) {
  const { selection } = useWorkspace()
  const [closed, setClosed] = useState(false)
  const [width, setWidthState] = useState(readWidth)

  const setWidth = useCallback((w: number) => {
    const next = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)))
    setWidthState(next)
    try { sessionStorage.setItem(WIDTH_KEY, String(next)) } catch { /* ignore */ }
  }, [])

  const value = useMemo<SidebarApi>(() => ({
    reveal: () => setClosed(false),
    hide: () => setClosed(true),
    open: selection != null && !closed,
    width,
    setWidth,
  }), [selection, closed, width, setWidth])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip label="Close details" side="left">
      <button
        onClick={onClick}
        aria-label="Close details"
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-muted before:absolute before:-inset-2 before:content-[''] hover:bg-ink-900/[0.06] hover:text-ink"
      >
        <Icon name="X" size={15} />
      </button>
    </Tooltip>
  )
}

/** Slide-in details sidebar. On desktop it sits beside the content (which
 *  reclaims the space when it closes) with a drag handle on its left edge;
 *  below `lg` it becomes a near-full-width drawer over the content. */
export function SalesDetailsSidebar({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const { open, hide, width, setWidth } = useSalesDetailsSidebar()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const dragging = useRef(false)
  const [live, setLive] = useState<number | null>(null)

  const clampToContainer = (w: number) => {
    const total = containerRef.current?.getBoundingClientRect().width ?? Infinity
    return Math.min(w, Math.max(SIDEBAR_MIN, total * MAX_SHARE))
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    setLive(width)
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    const right = containerRef.current?.getBoundingClientRect().right ?? window.innerWidth
    setLive(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, clampToContainer(right - e.clientX))))
  }
  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    dragging.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (live != null) setWidth(live)
    setLive(null)
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(clampToContainer(width + 24)) }
    if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(width - 24) }
  }

  const shown = live ?? clampToContainer(width)

  if (!isDesktop) {
    return (
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={hide}
              className="fixed inset-0 z-[44] bg-ink-900/30"
            />
            <motion.aside
              key="drawer"
              aria-label="Details"
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              className="fixed inset-y-0 right-0 z-[45] flex w-[94vw] max-w-[480px] flex-col border-l border-line bg-paper shadow-pop"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
                <span className="text-sm font-semibold text-ink-900">Details</span>
                <CloseButton onClick={hide} />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin"><DetailsPanel /></div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          key="sidebar"
          aria-label="Details"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: shown, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={live != null ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 40 }}
          className="relative shrink-0 overflow-hidden border-l border-line bg-paper"
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize details panel"
            aria-valuemin={SIDEBAR_MIN}
            aria-valuemax={SIDEBAR_MAX}
            aria-valuenow={Math.round(shown)}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-ink-900/15 focus-visible:bg-ink-900/20 focus-visible:outline-none"
          />
          <div className="flex h-full flex-col" style={{ width: shown }}>
            <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Details</span>
              <CloseButton onClick={hide} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin"><DetailsPanel /></div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
