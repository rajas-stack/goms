import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { geoMercator, geoPath } from 'd3-geo'
import { motion } from 'framer-motion'
import statesGeo from '@/assets/india-states.json'
import { useStates } from '@/lib/api'
import { repository } from '@/data/repository'
import { Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
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
    <div className="relative h-full w-full">
      <div
        ref={viewportRef}
        className={cn('h-full w-full touch-none select-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
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
        <defs>
          <filter id="mapshadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#0F2942" floodOpacity="0.14" />
          </filter>
        </defs>
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
        <g filter="url(#mapshadow)">
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
                className={cn('cursor-pointer transition-[fill,stroke] duration-150', fillClass, strokeClass)}
                strokeWidth={isSelected ? 2.2 : isHover ? 1.1 : 0.6}
              />
            )
          })}
        </g>
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
              stroke: connectedCountOf(selectedVisible.code) > 0 ? '#0F2942' : '#FAFAF7',
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

      <div className="absolute bottom-3 left-3 z-20 max-w-[230px] rounded-xl border border-line bg-paper/95 p-3 shadow-panel backdrop-blur" data-map-ui>
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
          <Select
            aria-label="Jump to a state"
            value={stateFeats.some((f) => f.code === selectedCode) ? String(selectedCode) : ''}
            onChange={(e) => setSelectedCode(e.target.value ? Number(e.target.value) : null)}
            className="h-9 w-full py-0 text-[12px]"
          >
            <option value="">Jump to state…</option>
            {stateFeats.map((f) => (
              <option key={f.code} value={f.code}>{f.name}</option>
            ))}
          </Select>
          <Select
            aria-label="Jump to a union territory"
            value={utFeats.some((f) => f.code === selectedCode) ? String(selectedCode) : ''}
            onChange={(e) => setSelectedCode(e.target.value ? Number(e.target.value) : null)}
            className="h-9 w-full py-0 text-[12px]"
          >
            <option value="">Jump to territory…</option>
            {utFeats.map((f) => (
              <option key={f.code} value={f.code}>{f.name}</option>
            ))}
          </Select>
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

      <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-xl border border-line bg-white/95 p-1 shadow-panel backdrop-blur" data-map-ui>
        <Tooltip label="Fit to screen">
          <button onClick={resetView} className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Fit to screen">
            <Icon name="Maximize" size={14} />
          </button>
        </Tooltip>
        <span className="mx-0.5 h-5 w-px bg-line" />
        <Tooltip label="Zoom out">
          <button onClick={() => zoomBy(0.85)} className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Zoom out">
            <span className="text-base leading-none">−</span>
          </button>
        </Tooltip>
        <span className="pointer-events-auto w-11 text-center font-mono text-[11px] text-muted">{Math.round(transform.scale * 100)}%</span>
        <Tooltip label="Zoom in">
          <button onClick={() => zoomBy(1 / 0.85)} className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Zoom in">
            <span className="text-base leading-none">+</span>
          </button>
        </Tooltip>
        <span className="mx-0.5 h-5 w-px bg-line" />
        <Tooltip label="Reset view">
          <button onClick={resetView} className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Reset view">
            <Icon name="MoveRight" size={14} className="rotate-[225deg]" />
          </button>
        </Tooltip>
      </div>

      {hover && active && (
        <div
          className="pointer-events-none fixed z-30 w-56 -translate-x-1/2 -translate-y-full rounded-xl border border-line bg-paper p-3 shadow-pop"
          style={{ left: hover.x, top: hover.y - 14 }}
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
