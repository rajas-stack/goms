// Pointer / touch drag-to-pan and wheel / trackpad scrolling for the timeline
// frame. Drag updates are coalesced to one per animation frame.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { TimelineViewport } from './useTimelineViewport'

const DRAG_THRESHOLD_PX = 4
const WHEEL_ZOOM_FACTOR = 1.15
/** Width used before the frame can be measured (and in DOM-less tests). */
export const FALLBACK_WIDTH_PX = 960

interface DragState { x0: number; startDay: number; moved: boolean }

const schedule = (cb: () => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : window.setTimeout(cb, 16)
const cancel = (id: number) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : window.clearTimeout(id))

/** Tracks an element's content width (ResizeObserver when available). */
export function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(FALLBACK_WIDTH_PX)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth > 0 ? el.clientWidth : FALLBACK_WIDTH_PX)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

export function useViewportGestures(ref: RefObject<HTMLElement>, vp: TimelineViewport) {
  const latest = useRef(vp)
  latest.current = vp
  const drag = useRef<DragState | null>(null)
  const frame = useRef<number | null>(null)
  const suppressClick = useRef(false)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current = { x0: e.clientX, startDay: latest.current.view.startDay, moved: false }
  }, [])

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x0
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return
    if (!d.moved) {
      drag.current = { ...d, moved: true }
      e.currentTarget.setPointerCapture?.(e.pointerId)
      setDragging(true)
    }
    const startDay = d.startDay - dx / latest.current.pxPerDay
    if (frame.current !== null) cancel(frame.current)
    frame.current = schedule(() => {
      frame.current = null
      latest.current.setWindow({ startDay, spanDays: latest.current.view.spanDays })
    })
  }, [])

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.moved) {
      suppressClick.current = true
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    }
    drag.current = null
    setDragging(false)
  }, [])

  /** A drag ends with a click on whatever is under the pointer; swallow it. */
  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    e.preventDefault()
    e.stopPropagation()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const v = latest.current
      if (e.ctrlKey || e.metaKey) {
        // Pinch / ctrl+wheel zooms the time scale here, never the browser page.
        e.preventDefault()
        const anchor = v.view.startDay + (e.clientX - el.getBoundingClientRect().left) / v.pxPerDay
        v.scale(e.deltaY > 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR, anchor)
        return
      }
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0
      if (!dx) return
      e.preventDefault()
      v.panPx(dx)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref])

  useEffect(() => () => { if (frame.current !== null) cancel(frame.current) }, [])

  return { dragging, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture } }
}
