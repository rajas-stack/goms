import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { geoMercator, geoPath } from 'd3-geo'
import { motion } from 'framer-motion'
import statesGeo from '@/assets/india-states.json'
import { useStates } from '@/lib/api'
import { repository } from '@/data/repository'
import { Combobox } from '@/components/ui/Combobox'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { cn } from '@/lib/utils'

const W = 760
const H = 860
const MIN_ZOOM = 0.6
const MAX_ZOOM = 8
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Fill for a "connected" state — a navy that sits alongside the ink/indigo
 *  palette. Used for the tooltip/legend swatches; the map paths use the same
 *  hex as literal Tailwind classes (`fill-[#1e3a8a]`), with `#15296b` as the
 *  matching darker navy for their hover fill and border. */
const NAVY = '#1e3a8a'

/** India's 8 union territories, by the name this dataset uses — everything
 *  else in the feature set is a state. No such flag exists in the source
 *  GeoJSON, so this fixed reference list drives the State/UT toggle. */
const UT_NAMES = new Set([
  'Jammu and Kashmir', 'Chandigarh', 'Delhi', 'Dadra and Nagar Haveli and Daman and Diu',
  'Lakshadweep', 'Puducherry', 'Andaman and Nicobar Islands', 'Ladakh',
])

interface Feat {
  code: number
  name: string
  d: string
  cx: number
  cy: number
}

export function IndiaMap() {
  const navigate = useNavigate()
  const { data: states = [] } = useStates()
  const [hover, setHover] = useState<{ code: number; x: number; y: number } | null>(null)
  const [showStates, setShowStates] = useState(true)
  const [showUTs, setShowUTs] = useState(true)
  const [selectedCode, setSelectedCode] = useState<number | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const filterAnchorRef = useRef<HTMLButtonElement>(null)

  // Per-state "connected" tally: a state counts as connected when at least one
  // active employee posted anywhere under it has `connected === true`. Derived
  // from the same repository the per-state counts come from (via the exact
  // `listEmployeesByState` used elsewhere). Vacant seats never count — they
  // carry `connected: false`.
  const { data: connectedByState } = useQuery({
    queryKey: ['statesConnected'],
    queryFn: async () => {
      const list = await repository.listStates()
      const map = new Map<number, number>()
      for (const s of list) {
        const emps = await repository.listEmployeesByState(s.code)
        map.set(s.code, emps.filter((e) => e.connected).length)
      }
      return map
    },
  })
  const connectedCountOf = useCallback(
    (code: number) => connectedByState?.get(code) ?? 0,
    [connectedByState],
  )

  const hoverRafRef = useRef<number | null>(null)
  const hoverDataRef = useRef<{ code: number; x: number; y: number } | null>(null)
  // Popup appearance/disappearance is applied immediately so it feels instant;
  // only the continuous mousemove position updates are throttled to a frame,
  // since those are what caused the pointer-tracking jank.
  const setHoverNow = useCallback((next: { code: number; x: number; y: number } | null) => {
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current)
      hoverRafRef.current = null
    }
    hoverDataRef.current = next
    setHover(next)
  }, [])
  const scheduleHover = useCallback((next: { code: number; x: number; y: number } | null) => {
    hoverDataRef.current = next
    if (hoverRafRef.current != null) return
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null
      setHover(hoverDataRef.current)
    })
  }, [])
  useEffect(() => () => {
    if (hoverRafRef.current != null) cancelAnimationFrame(hoverRafRef.current)
  }, [])

  // Entering/leaving a state flips the viewport's cursor between `grab` and
  // `pointer`. Chrome on Windows can fail to redraw the OS cursor for a
  // `cursor` value change that isn't accompanied by a fresh native mousemove
  // (as here, where it's driven by React state), leaving it invisible until
  // the pointer exits and re-enters the window. Forcing an explicit cursor
  // value and releasing it a frame later makes Chrome recompute it right away
  // instead of waiting for that — the same fix already confirmed working for
  // the card-drag cursor bug on the org/people canvas.
  const isOverFeature = hover != null
  useEffect(() => {
    const root = document.documentElement
    root.style.cursor = 'default'
    const raf = requestAnimationFrame(() => { root.style.cursor = '' })
    return () => cancelAnimationFrame(raf)
  }, [isOverFeature])

  // Pan/zoom — same manual transform technique as the Geography explorer's
  // map (GeoMapView): a {x,y,scale} applied to a wrapping <g>, wheel-to-zoom
  // centered on the cursor, and drag-to-pan.
  //
  // Capture is deferred until the pointer actually moves past a small
  // threshold — NOT applied on pointerdown itself. Calling setPointerCapture
  // immediately would redirect the pointerup's derived `click` event from the
  // state path to the capturing div, silently swallowing every click (a plain
  // click never moves, so it never captures, so the path's own onClick still
  // fires normally); only a real drag captures and pans, and its trailing
  // click lands on the div instead of a state, so panning never accidentally
  // triggers navigation either.
  const DRAG_THRESHOLD = 4
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    startX: number; startY: number; originX: number; originY: number; pointerId: number; captured: boolean
  } | null>(null)
  const [dragging, setDragging] = useState(false)
  const panRafRef = useRef<number | null>(null)
  const panPointRef = useRef<{ clientX: number; clientY: number } | null>(null)
  // Two-finger pinch-to-zoom: Pointer Events already deliver a distinct
  // `pointerId` per touch point, so this just tracks every currently-down
  // pointer and, once 2 are active, treats their distance/midpoint as a zoom
  // gesture instead of a pan — mirroring `onWheel`'s centering math (scale
  // ratio applied around a fixed screen point) frame-to-frame rather than
  // against one fixed start distance, so pinch and two-finger drag compose
  // naturally.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{ dist: number } | null>(null)

  const resetView = useCallback(() => setTransform({ x: 0, y: 0, scale: 1 }), [])

  const zoomBy = useCallback((factor: number) => {
    const vp = viewportRef.current
    if (!vp) return
    const rect = vp.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    setTransform((t) => {
      const next = clamp(t.scale * factor, MIN_ZOOM, MAX_ZOOM)
      const ratio = next / t.scale
      return { scale: next, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio }
    })
  }, [])

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const rect = viewportRef.current!.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    setTransform((t) => {
      const next = clamp(t.scale * (1 - e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM)
      const ratio = next / t.scale
      return { scale: next, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio }
    })
  }

  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('[data-map-ui]')) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointersRef.current.size >= 2) {
      // A second finger just landed — hand off from single-finger pan (if
      // one was active/captured) to pinch-zoom. `pinchRef` starts null so
      // the next move only baselines the start distance rather than jumping
      // the zoom.
      dragRef.current = null
      setDragging(false)
      pinchRef.current = null
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    dragRef.current = {
      startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y,
      pointerId: e.pointerId, captured: false,
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }
    if (pointersRef.current.size >= 2) {
      const [a, b] = Array.from(pointersRef.current.values())
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      const cx = (a.x + b.x) / 2 - rect.left
      const cy = (a.y + b.y) / 2 - rect.top
      if (!pinchRef.current) {
        // First move after the 2nd finger touches down — establish the
        // baseline distance only, same as a fresh drag origin.
        pinchRef.current = { dist }
        return
      }
      const factor = dist / pinchRef.current.dist
      pinchRef.current.dist = dist
      setTransform((t) => {
        const next = clamp(t.scale * factor, MIN_ZOOM, MAX_ZOOM)
        const ratio = next / t.scale
        return { scale: next, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio }
      })
      return
    }
    const drag = dragRef.current
    if (!drag) return
    if (!drag.captured) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return
      drag.captured = true
      setDragging(true)
      ;(e.currentTarget as HTMLElement).setPointerCapture(drag.pointerId)
    }
    panPointRef.current = { clientX: e.clientX, clientY: e.clientY }
    if (panRafRef.current != null) return
    panRafRef.current = requestAnimationFrame(() => {
      panRafRef.current = null
      const p = panPointRef.current
      const d = dragRef.current
      if (!p || !d) return
      setTransform((t) => ({ ...t, x: d.originX + (p.clientX - d.startX), y: d.originY + (p.clientY - d.startY) }))
    })
  }
  // Shared by pointerup, pointercancel AND lostpointercapture — capture can be
  // revoked mid-drag by the browser, and without this the pan state/cursor
  // would be left stuck. Deliberately NOT wired to pointerleave: once
  // captured, panning routinely carries the pointer outside the viewport's
  // bounds, and pointerleave still fires on hit-test boundary crossing even
  // under capture — ending the drag there would make panning die the instant
  // the cursor drifts past the edge, well before the button is released.
  //
  // Also removes the ending pointer from the pinch-tracking map. Lifting one
  // finger out of a 2-finger pinch does NOT try to seamlessly resume a
  // single-finger pan — the remaining finger has to be released and pressed
  // again to start a fresh gesture (see the pinch-tracking comment above
  // `pointersRef`), a deliberate simplification for this polish-level task.
  function endPan(e?: React.PointerEvent) {
    if (e) pointersRef.current.delete(e.pointerId)
    else pointersRef.current.clear() // hard fallback (blur/visibilitychange): drop everything
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size > 0) return
    dragRef.current = null
    setDragging(false)
    if (panRafRef.current != null) {
      cancelAnimationFrame(panRafRef.current)
      panRafRef.current = null
    }
  }

  // Hard fallback for gestures the browser never delivers a pointerup for
  // (alt-tab away mid-drag) — without this, `dragging` (and the grabbing
  // cursor) can stay stuck indefinitely.
  useEffect(() => {
    if (!dragging) return
    const stop = () => endPan()
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', stop)
    return () => {
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', stop)
    }
  }, [dragging])

  // With a state/UT chosen from a dropdown, Enter opens it — the keyboard
  // counterpart to clicking the highlighted state. Skip while a text field is
  // focused so it never hijacks typing (e.g. the ⌘K search input).
  useEffect(() => {
    if (selectedCode == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      navigate(`/state/${selectedCode}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedCode, navigate])

  const byCode = useMemo(() => new Map(states.map((s) => [s.code, s])), [states])

  const feats = useMemo<Feat[]>(() => {
    const fc = statesGeo as never
    const projection = geoMercator().fitExtent(
      [[24, 24], [W - 24, H - 24]],
      fc,
    )
    const path = geoPath(projection)
    return statesGeo.features.map((f) => {
      const [cx, cy] = path.centroid(f as never)
      return {
        code: Number(f.properties.st_code),
        name: String(f.properties.st_nm),
        d: path(f as never) ?? '',
        cx,
        cy,
      }
    })
  }, [])

  // Split for the two dropdowns; each list is alphabetical by name. `featByCode`
  // resolves a dropdown selection back to its geometry for the highlight/label.
  const [stateFeats, utFeats] = useMemo(() => {
    const s: Feat[] = []
    const u: Feat[] = []
    for (const f of feats) (UT_NAMES.has(f.name) ? u : s).push(f)
    const byName = (a: Feat, b: Feat) => a.name.localeCompare(b.name)
    return [s.sort(byName), u.sort(byName)]
  }, [feats])
  const featByCode = useMemo(() => new Map(feats.map((f) => [f.code, f])), [feats])
  const selectedFeat = selectedCode != null ? featByCode.get(selectedCode) : undefined

  // Combobox options for the two "jump to" pickers — typing filters in real
  // time, same as every other searchable dropdown in the app.
  const stateOptions = useMemo(() => stateFeats.map((f) => ({ value: String(f.code), label: f.name })), [stateFeats])
  const utOptions = useMemo(() => utFeats.map((f) => ({ value: String(f.code), label: f.name })), [utFeats])

  const active = hover ? byCode.get(hover.code) : undefined
  const hoverConnected = hover ? connectedCountOf(hover.code) : 0
  const visibleFeats = feats.filter((f) => (UT_NAMES.has(f.name) ? showUTs : showStates))
  // The highlighted label only renders when its feature is actually on the map
  // (i.e. not hidden by the State/UT show-hide checkboxes).
  const selectedVisible =
    selectedFeat && visibleFeats.some((f) => f.code === selectedFeat.code) ? selectedFeat : undefined

  // Legend tallies over the currently-visible states (respects the State/UT
  // filter). A state is at most one bucket: connected → populated → awaiting.
  const legend = { connected: 0, populated: 0, awaiting: 0 }
  for (const f of visibleFeats) {
    if (connectedCountOf(f.code) > 0) legend.connected += 1
    else if ((byCode.get(f.code)?.employees ?? 0) > 0) legend.populated += 1
    else legend.awaiting += 1
  }

  return (
    // `pt-20` below `md`: reserves a strip at the top for the mobile Filter
    // button and legend so neither sits ON the map (80px clears the taller of
    // the two — the 3-row legend). Absolutely positioned children offset from
    // this element's PADDING box, so they land in the strip, while the pan
    // viewport (`h-full`, below) starts under it.
    <div className="relative h-full w-full pt-20 md:pt-0">
      <div
        ref={viewportRef}
        className={cn(
          'h-full w-full touch-none select-none',
          // Cursor lives here, on the one ancestor div, instead of on each
          // <path> below. Chrome on Windows can render the OS cursor invisible
          // (until the pointer leaves and re-enters the window) when it
          // crosses an SVG element that sets its own `cursor` value that
          // differs from an ancestor's — and this map flips that per-path
          // value on every state boundary crossing. Deriving it here from
          // `hover` instead keeps exactly one element's cursor ever changing.
          dragging ? 'cursor-grabbing' : hover ? 'cursor-pointer' : 'cursor-grab',
        )}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onLostPointerCapture={endPan}
      >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Map of India — select a state to open its workspace"
      >
        {/* This group used to sit inside an SVG <filter> (a feDropShadow):
            Chrome on Windows forces a software-rasterized cursor — missing
            its usual outline — for any region painted under an active SVG
            filter, and the filter's bounding box covered this entire map, not
            just the state shapes. That's why the cursor's border went
            missing hovering anywhere over the map, and why changing the
            `cursor` CSS value didn't help — the filter was the trigger, not
            the cursor value. */}
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
          {visibleFeats.map((f, i) => {
            const summary = byCode.get(f.code)
            const populated = (summary?.employees ?? 0) > 0
            const isConnected = connectedCountOf(f.code) > 0
            const isHover = hover?.code === f.code
            const isSelected = selectedCode === f.code
            // Fill still tracks status/hover; a selected state overrides the
            // stroke with an amber ring so it reads distinctly from hover (ink)
            // and the navy/teal status outlines.
            const fillClass = isHover
              ? isConnected ? 'fill-[#15296b]' : 'fill-indigo'
              : isConnected ? 'fill-[#1e3a8a]'
                : populated ? 'fill-teal/20'
                  : 'fill-white'
            const strokeClass = isSelected
              ? 'stroke-amber'
              : isHover ? 'stroke-ink-900'
                : isConnected ? 'stroke-[#15296b]'
                  : populated ? 'stroke-teal-600'
                    : 'stroke-ink-600/50'
            return (
              <motion.path
                key={f.code}
                d={f.d}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.008, 0.4), duration: 0.4 }}
                onMouseEnter={(e) => setHoverNow({ code: f.code, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => scheduleHover({ code: f.code, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHoverNow(null)}
                onClick={() => navigate(`/state/${f.code}`)}
                className={cn('transition-[fill,stroke] duration-150', fillClass, strokeClass)}
                strokeWidth={isSelected ? 2.2 : isHover ? 1.1 : 0.6}
              />
            )
          })}
        {visibleFeats
          .filter((f) => (byCode.get(f.code)?.employees ?? 0) > 0)
          .map((f) => (
            <circle
              key={`dot-${f.code}`}
              cx={f.cx}
              cy={f.cy}
              r={2.4}
              className={cn(
                'pointer-events-none',
                connectedCountOf(f.code) > 0 ? 'fill-blue-100' : 'fill-teal-600',
              )}
            />
          ))}
        {selectedVisible && (
          <text
            x={selectedVisible.cx}
            y={selectedVisible.cy}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
            className={cn(
              'pointer-events-none select-none font-sans font-semibold',
              connectedCountOf(selectedVisible.code) > 0 ? 'fill-paper' : 'fill-ink-900',
            )}
            // A halo in the opposite tone keeps the label legible over navy,
            // teal-tint and white fills alike (paint the stroke first).
            style={{
              paintOrder: 'stroke',
              stroke: connectedCountOf(selectedVisible.code) > 0 ? 'rgb(var(--c-ink-900))' : 'rgb(var(--c-paper))',
              strokeWidth: 2.8,
              strokeLinejoin: 'round',
            }}
          >
            {selectedVisible.name}
          </text>
        )}
        </g>
      </svg>
      </div>

      {/* Desktop (md+): one combined legend + State/UT filter + jump-to
          panel, always visible, top-right. */}
      <div className="hidden md:block absolute top-3 right-3 z-20 max-w-[230px] rounded-xl border border-line bg-paper/95 p-3 shadow-panel pointer-events-auto" data-map-ui>
        <div className="min-w-[140px] space-y-1.5 text-[11px]">
          <LegendRow
            swatch={<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: NAVY }} />}
            label="Connected"
            count={legend.connected}
          />
          <LegendRow
            swatch={<span className="h-2.5 w-2.5 rounded-full bg-teal/20 ring-1 ring-teal-600" />}
            label="Populated"
            count={legend.populated}
          />
          <LegendRow
            swatch={<span className="h-2.5 w-2.5 rounded-full bg-white ring-1 ring-ink-600/50" />}
            label="Awaiting data"
            count={legend.awaiting}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2 text-[11px] font-medium text-ink-800">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={showStates} onChange={(e) => setShowStates(e.target.checked)} className="accent-ink-900" />
            States
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={showUTs} onChange={(e) => setShowUTs(e.target.checked)} className="accent-ink-900" />
            Union Territories
          </label>
        </div>
        <div className="mt-2 space-y-2 border-t border-line pt-2">
          {showStates && (
            <Combobox
              aria-label="Jump to a state"
              value={stateFeats.some((f) => f.code === selectedCode) ? String(selectedCode) : ''}
              onChange={(v) => setSelectedCode(v ? Number(v) : null)}
              options={stateOptions}
              placeholder="Jump to state…"
            />
          )}
          {showUTs && (
            <Combobox
              aria-label="Jump to a union territory"
              value={utFeats.some((f) => f.code === selectedCode) ? String(selectedCode) : ''}
              onChange={(v) => setSelectedCode(v ? Number(v) : null)}
              options={utOptions}
              placeholder="Jump to territory…"
            />
          )}
          {selectedFeat && (
            <button
              type="button"
              onClick={() => navigate(`/state/${selectedFeat.code}`)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-ink-900 px-3 py-2 text-[12px] font-medium text-paper transition-colors hover:bg-ink-800"
            >
              Open {selectedFeat.name}
              <span aria-hidden>→</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile only (below md) — legend and Filter button both live in the
          reserved top strip (see the container's `pt-[74px]`), so the map
          itself is never covered. State/UT filter + jump-to sit behind the
          Filter button's popup. */}
      <div className="md:hidden absolute top-2 right-3 z-20 w-[124px] rounded-lg border border-line bg-paper/95 p-2 shadow-panel pointer-events-auto" data-map-ui>
        <div className="space-y-1 text-[10px]">
          <LegendRow
            swatch={<span className="h-2 w-2 rounded-full" style={{ backgroundColor: NAVY }} />}
            label="Connected"
            count={legend.connected}
          />
          <LegendRow
            swatch={<span className="h-2 w-2 rounded-full bg-teal/20 ring-1 ring-teal-600" />}
            label="Populated"
            count={legend.populated}
          />
          <LegendRow
            swatch={<span className="h-2 w-2 rounded-full bg-white ring-1 ring-ink-600/50" />}
            label="Awaiting"
            count={legend.awaiting}
          />
        </div>
      </div>

      <button
        ref={filterAnchorRef}
        type="button"
        onClick={() => setFilterOpen((v) => !v)}
        aria-label="Filter states and union territories"
        className={cn(
          'md:hidden absolute top-2 left-3 z-20 flex h-11 items-center gap-1.5 rounded-lg border border-line bg-paper/95 px-3 text-[12px] font-medium text-ink-800 shadow-panel transition-colors pointer-events-auto hover:border-ink-600',
          filterOpen && 'border-ink-600 bg-panel',
        )}
        data-map-ui
      >
        <Icon name="SlidersHorizontal" size={14} />
        Filter
        {selectedFeat && <span className="rounded-full bg-ink-900 px-1.5 py-0.5 text-[10px] text-paper">1</span>}
      </button>
      <PopoverPanel open={filterOpen} anchorRef={filterAnchorRef} onClose={() => setFilterOpen(false)} align="start" gap={6}>
        {() => (
          <motion.div
            data-canvas-ui
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="w-64 space-y-2 rounded-xl border border-line bg-paper p-3 shadow-pop"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] font-medium text-ink-800">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={showStates} onChange={(e) => setShowStates(e.target.checked)} className="accent-ink-900" />
                States
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={showUTs} onChange={(e) => setShowUTs(e.target.checked)} className="accent-ink-900" />
                Union Territories
              </label>
            </div>
            <div className="space-y-2 border-t border-line pt-2">
              {showStates && (
                <Combobox
                  aria-label="Jump to a state"
                  value={stateFeats.some((f) => f.code === selectedCode) ? String(selectedCode) : ''}
                  onChange={(v) => setSelectedCode(v ? Number(v) : null)}
                  options={stateOptions}
                  placeholder="Jump to state…"
                />
              )}
              {showUTs && (
                <Combobox
                  aria-label="Jump to a union territory"
                  value={utFeats.some((f) => f.code === selectedCode) ? String(selectedCode) : ''}
                  onChange={(v) => setSelectedCode(v ? Number(v) : null)}
                  options={utOptions}
                  placeholder="Jump to territory…"
                />
              )}
              {selectedFeat && (
                <button
                  type="button"
                  onClick={() => { setFilterOpen(false); navigate(`/state/${selectedFeat.code}`) }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-ink-900 px-3 py-2 text-[12px] font-medium text-paper transition-colors hover:bg-ink-800"
                >
                  Open {selectedFeat.name}
                  <span aria-hidden>→</span>
                </button>
              )}
            </div>
          </motion.div>
        )}
      </PopoverPanel>

      {/* Bottom-LEFT on a phone: the global FAB owns the bottom-right corner
          there, and the two clusters were colliding. From `sm` up the FAB
          moves into the same corner as this cluster (`lg:right-8`), so this
          sits further out than its own edge padding would suggest — enough
          to clear the FAB with room to spare instead of butting up against it. */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-0.5 rounded-xl border border-line bg-white/95 p-0.5 shadow-panel sm:gap-1 sm:p-1 sm:left-auto sm:right-28" data-map-ui>
        {/* Fit-to-screen and Reset (below) both just call `resetView`, so the
            phone keeps one of them — the full 5-slot desktop cluster overran
            the map's own width at 390px. Buttons themselves also shrink below
            `sm` (h-7/w-7 vs h-8/w-8) — at full size this cluster covered part
            of the map's southern states on short/narrow viewports. */}
        <Tooltip label="Fit to screen" className="hidden sm:inline-flex">
          <button onClick={resetView} className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900 sm:h-8 sm:w-8" aria-label="Fit to screen">
            <Icon name="Maximize" size={14} />
          </button>
        </Tooltip>
        <span className="mx-0.5 hidden h-5 w-px bg-line sm:block" />
        <Tooltip label="Zoom out">
          <button onClick={() => zoomBy(0.85)} className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900 sm:h-8 sm:w-8" aria-label="Zoom out">
            <span className="text-sm leading-none sm:text-base">−</span>
          </button>
        </Tooltip>
        <span className="pointer-events-auto w-8 text-center font-mono text-[10px] text-muted sm:w-11 sm:text-[11px]">{Math.round(transform.scale * 100)}%</span>
        {/* These two sit closest to the global FAB's bottom-right corner —
            a "top" tooltip here pops up right underneath/behind it. "left"
            keeps the label inside the cluster instead of colliding. */}
        <Tooltip label="Zoom in" side="left">
          <button onClick={() => zoomBy(1 / 0.85)} className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900 sm:h-8 sm:w-8" aria-label="Zoom in">
            <span className="text-sm leading-none sm:text-base">+</span>
          </button>
        </Tooltip>
        <span className="mx-0.5 h-5 w-px bg-line" />
        <Tooltip label="Reset view" side="left">
          <button onClick={resetView} className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900 sm:h-8 sm:w-8" aria-label="Reset view">
            <Icon name="MoveRight" size={12} className="rotate-[225deg] sm:hidden" />
            <Icon name="MoveRight" size={14} className="hidden rotate-[225deg] sm:block" />
          </button>
        </Tooltip>
      </div>

      {hover && active && (
        <div
          className="pointer-events-none fixed z-30 w-56 -translate-x-1/2 rounded-xl border border-line bg-paper p-3 shadow-pop"
          style={{ left: Math.max(120, Math.min(window.innerWidth - 120, hover.x)), top: hover.y + 20 }}
        >
          <div className="flex items-center justify-between">
            <span className="font-display text-sm font-semibold text-ink-900">{active.name}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <Stat label="Depts" value={active.departments} />
            <Stat label="Offices" value={active.offices} />
            <Stat label="People" value={active.employees} />
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: NAVY }} />
            <span className="font-mono tabular-nums text-ink-800">{hoverConnected}</span>
            connected contact{hoverConnected === 1 ? '' : 's'}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-panel py-1">
      <div className="font-mono text-sm font-semibold text-ink-900">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  )
}

function LegendRow({ swatch, label, count }: { swatch: ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 text-muted">
      {swatch}
      <span>{label}</span>
      <span className="ml-auto font-mono tabular-nums text-ink-800">{count}</span>
    </div>
  )
}
