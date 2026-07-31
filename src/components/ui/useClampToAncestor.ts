import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

const EDGE_PAD = 8

/** Nearest ancestor that actually clips overflow (an `overflow-y-auto` panel
 *  forces its computed `overflow-x` to `auto` too, so it clips horizontally
 *  even though only the vertical axis was styled) — falls back to the
 *  viewport when nothing clips. */
function clippingBounds(el: HTMLElement): { left: number; right: number; top: number; bottom: number } {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const cs = getComputedStyle(node)
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden'
      || cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'hidden') {
      const r = node.getBoundingClientRect()
      return { left: r.left + EDGE_PAD, right: r.right - EDGE_PAD, top: r.top + EDGE_PAD, bottom: r.bottom - EDGE_PAD }
    }
    node = node.parentElement
  }
  return { left: EDGE_PAD, right: window.innerWidth - EDGE_PAD, top: EDGE_PAD, bottom: window.innerHeight - EDGE_PAD }
}

/** A popup anchored near the edge of a narrow scrollable ancestor (e.g. the
 *  details sidebar) can render partly outside it, where it's clipped by that
 *  ancestor's own scroll boundary and effectively invisible or unreachable —
 *  this nudges it back into the nearest clipping ancestor (or the viewport)
 *  on both axes, and keeps it corrected across a window resize while open. */
export function useClampToAncestor(open: boolean, popupRef: RefObject<HTMLElement>): CSSProperties | undefined {
  const [clampStyle, setClampStyle] = useState<CSSProperties>()
  const clampRef = useRef({ dx: 0, dy: 0 })
  const recomputeRef = useRef<() => void>(() => {})

  recomputeRef.current = () => {
    const popup = popupRef.current
    if (!popup) return
    const rect = popup.getBoundingClientRect()
    const bounds = clippingBounds(popup)
    
    const unx = rect.left - clampRef.current.dx
    const uny = rect.top - clampRef.current.dy
    const right = rect.right - clampRef.current.dx
    const bottom = rect.bottom - clampRef.current.dy

    let dx = 0
    if (unx < bounds.left) dx = bounds.left - unx
    else if (right > bounds.right) dx = bounds.right - right

    let dy = 0
    if (uny < bounds.top) dy = bounds.top - uny
    else if (bottom > bounds.bottom) dy = bounds.bottom - bottom

    clampRef.current = { dx, dy }
    setClampStyle(dx !== 0 || dy !== 0 ? { '--nudge-x': `${dx}px`, '--nudge-y': `${dy}px` } as CSSProperties : undefined)
  }

  useLayoutEffect(() => {
    if (!open) {
      clampRef.current = { dx: 0, dy: 0 }
      setClampStyle(undefined)
      return
    }
    // A single on-open measurement can catch the trigger mid-animation (e.g.
    // a button inside a Dialog that's still spring-animating in) and lock
    // that stale offset in permanently, since nothing used to re-measure
    // afterwards — visibly stranding the tooltip far from its trigger.
    // Tracking continuously via rAF for as long as the tooltip is open fixes
    // that the same way `usePopoverPosition` does for dropdown panels.
    let raf = requestAnimationFrame(function loop() {
      recomputeRef.current()
      raf = requestAnimationFrame(loop)
    })
    const onResize = () => recomputeRef.current()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return clampStyle
}
