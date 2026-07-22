import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

const MIN_ZOOM = 0.6
const MAX_ZOOM = 8
const DRAG_THRESHOLD = 4
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Manual pan/zoom for an SVG map: wheel-to-zoom centered on the cursor,
 *  drag-to-pan, Fit/Reset. Shared by every map in the Geography explorer so
 *  the click-vs-drag fix only has to exist in one place.
 *
 *  Capture is deferred until the pointer moves past a small threshold — NOT
 *  applied on pointerdown itself. Capturing immediately would redirect the
 *  pointerup's derived `click` event from the clicked shape to the capturing
 *  div, silently swallowing every click (a plain click never moves, so it
 *  never captures, so the shape's own onClick still fires normally); only a
 *  real drag captures and pans, and its trailing click lands on the div
 *  instead of a shape, so panning never accidentally triggers navigation. */
export function useMapPanZoom(viewportRef: RefObject<HTMLDivElement>) {
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{
    startX: number; startY: number; originX: number; originY: number; pointerId: number; captured: boolean
  } | null>(null)
  const rafRef = useRef<number | null>(null)
  const pointRef = useRef<{ clientX: number; clientY: number } | null>(null)
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
  }, [viewportRef])

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
    pointRef.current = { clientX: e.clientX, clientY: e.clientY }
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const p = pointRef.current
      const d = dragRef.current
      if (!p || !d) return
      setTransform((t) => ({ ...t, x: d.originX + (p.clientX - d.startX), y: d.originY + (p.clientY - d.startY) }))
    })
  }
  // Shared by pointerup, pointercancel AND lostpointercapture — capture can
  // be revoked mid-drag by the browser, and without this the pan state/cursor
  // would be left stuck indefinitely. Deliberately NOT wired to pointerleave:
  // once captured, panning routinely carries the pointer outside the
  // viewport's bounds (that's the point of panning near an edge), and
  // pointerleave still fires on hit-test boundary crossing even under
  // capture — ending the drag there would make panning die the instant the
  // cursor drifts past the edge, well before the mouse button is released.
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
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  // Hard fallback for gestures the browser never delivers a pointerup for at
  // all (alt-tab away mid-drag, releasing over another window) — without
  // this, `dragging` (and the grabbing cursor) can stay stuck indefinitely.
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

  return { transform, setTransform, dragging, resetView, zoomBy, onWheel, onPointerDown, onPointerMove, endPan }
}
