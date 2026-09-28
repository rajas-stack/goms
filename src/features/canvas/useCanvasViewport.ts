import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

const MIN_ZOOM = 0.3
const MAX_ZOOM = 1.8
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export interface CanvasTransform {
  x: number
  y: number
  scale: number
}

/** The pan/zoom viewport engine shared by every canvas surface —
 *  Organization/People/Geo (via `HierarchyCanvas`) and the Sales Org Chart —
 *  so they navigate identically instead of each growing their own controls.
 *  Wheel-zoom (ctrl/cmd+scroll), plain-scroll pan, drag-to-pan, two-finger
 *  pinch-to-zoom, fit-to-screen, and a plain re-center all drive one CSS
 *  transform applied to `contentRef` inside `viewportRef`. Anything
 *  domain-specific (jumping the camera to a searched-for card, arrow-key
 *  card navigation) stays in the calling canvas — this hook only owns the
 *  transform itself. */
export function useCanvasViewport(
  viewportRef: RefObject<HTMLDivElement>,
  contentRef: RefObject<HTMLDivElement>,
  initial: CanvasTransform = { x: 40, y: 56, scale: 1 },
) {
  const [transform, setTransform] = useState<CanvasTransform>(initial)
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const panRafRef = useRef<number | null>(null)
  const panPointRef = useRef<{ clientX: number; clientY: number } | null>(null)
  // Two-finger pinch-to-zoom: Pointer Events already deliver a distinct
  // `pointerId` per touch point, so this just tracks every currently-down
  // pointer and, once 2 are active, treats their distance/midpoint as a
  // zoom gesture instead of a pan — mirroring `onWheel`'s ctrl-zoom centering
  // math (scale ratio applied around a fixed screen point) frame-to-frame
  // rather than against a single fixed start distance, so a pinch and a
  // two-finger drag can compose naturally.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{ dist: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const userInteractedRef = useRef(false)

  const centerView = useCallback(() => {
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!content || !viewport || content.scrollWidth === 0) return false
    const vw = viewport.clientWidth
    const cw = content.scrollWidth
    setTransform({ x: (vw - cw) / 2, y: 56, scale: 1 })
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fitToScreen = useCallback(() => {
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!content || !viewport || content.scrollWidth === 0 || content.scrollHeight === 0) return false
    userInteractedRef.current = true
    const pad = 48
    const vw = viewport.clientWidth - pad * 2
    const vh = viewport.clientHeight - pad * 2
    const cw = content.scrollWidth
    const ch = content.scrollHeight
    const scale = clamp(Math.min(vw / cw, vh / ch), MIN_ZOOM, MAX_ZOOM)
    setTransform({ x: (viewport.clientWidth - cw * scale) / 2, y: pad, scale })
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    userInteractedRef.current = true
    const rect = viewportRef.current!.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      setTransform((t) => {
        const next = clamp(t.scale * (1 - e.deltaY * 0.012), MIN_ZOOM, MAX_ZOOM)
        const ratio = next / t.scale
        return { scale: next, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio }
      })
    } else {
      setTransform((t) => ({ ...t, x: t.x - e.deltaX, y: t.y - e.deltaY }))
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('[data-canvas-card], [data-canvas-ui]')) return
    userInteractedRef.current = true
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (pointersRef.current.size >= 2) {
      // A second finger just landed — hand off from single-finger pan (if
      // one was active) to pinch-zoom. `pinchRef` starts null so the next
      // move only baselines the start distance rather than jumping the zoom.
      dragRef.current = null
      setDragging(false)
      pinchRef.current = null
      return
    }
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y }
    setDragging(true)
    // Prevents the details sidebar's text from being selected mid-drag, which
    // otherwise swaps in a text-selection cursor and can leave the pointer
    // looking "stuck" once the drag crosses back onto the canvas.
    document.body.classList.add('select-none')
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
        // baseline distance only, same as a fresh `onPointerDown` origin.
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
    if (!dragRef.current) return
    panPointRef.current = { clientX: e.clientX, clientY: e.clientY }
    if (panRafRef.current != null) return
    panRafRef.current = requestAnimationFrame(() => {
      panRafRef.current = null
      const point = panPointRef.current
      if (!point || !dragRef.current) return
      const dx = point.clientX - dragRef.current.startX
      const dy = point.clientY - dragRef.current.startY
      setTransform((t) => ({ ...t, x: dragRef.current!.originX + dx, y: dragRef.current!.originY + dy }))
    })
  }

  // Shared by pointerup, pointercancel AND lostpointercapture — capture can
  // be revoked by the browser mid-drag (e.g. a context menu, or crossing into
  // the details sidebar's own scrollable/focusable content), and without this
  // the drag state and cursor would be left stuck in "panning" indefinitely.
  // Deliberately NOT wired to pointerleave: capture is taken on pointerdown,
  // so pointerup still fires here even once the cursor has panned outside
  // the viewport's own bounds — ending on pointerleave would make panning
  // die the instant the cursor drifts past the edge, before the button is
  // released, and leave `select-none` stuck on <body> since it's the
  // pointerup/lostpointercapture path (not pointerleave) that was meant to
  // clear it.
  //
  // Also removes the ending pointer from the pinch-tracking map. Lifting one
  // finger out of a 2-finger pinch does NOT try to seamlessly resume a
  // single-finger pan — the remaining finger has to be released and pressed
  // again to start a fresh gesture. That's a deliberate simplification: this
  // still leaves pinch and pan both fully working, just not chainable
  // without a full release.
  function endPan(e?: React.PointerEvent) {
    if (e) pointersRef.current.delete(e.pointerId)
    else pointersRef.current.clear() // hard fallback (blur/visibilitychange): drop everything
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size > 0) return
    dragRef.current = null
    setDragging(false)
    document.body.classList.remove('select-none')
    if (panRafRef.current != null) {
      cancelAnimationFrame(panRafRef.current)
      panRafRef.current = null
    }
  }

  // Hard fallback for gestures the browser never delivers a pointerup for
  // (alt-tab away mid-drag) — without this, `dragging`/the grabbing cursor
  // and <body>'s select-none lock can stay stuck indefinitely.
  useEffect(() => {
    if (!dragging) return
    const stop = () => endPan()
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', stop)
    return () => {
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', stop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  function zoomBy(factor: number) {
    const viewport = viewportRef.current
    if (!viewport) return
    userInteractedRef.current = true
    const cx = viewport.clientWidth / 2
    const cy = viewport.clientHeight / 2
    setTransform((t) => {
      const next = clamp(t.scale * factor, MIN_ZOOM, MAX_ZOOM)
      const ratio = next / t.scale
      return { scale: next, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio }
    })
  }

  function resetView() {
    userInteractedRef.current = false
    centerView()
  }

  return {
    transform, dragging, userInteractedRef,
    onWheel, onPointerDown, onPointerMove, endPan,
    fitToScreen, centerView, zoomBy, resetView, setTransform,
  }
}
