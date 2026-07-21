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
  const recomputeRef = useRef<() => void>(() => {})

  recomputeRef.current = () => {
    const popup = popupRef.current
    if (!popup) return
    const rect = popup.getBoundingClientRect()
    const bounds = clippingBounds(popup)
    let dx = 0
    if (rect.left < bounds.left) dx = bounds.left - rect.left
    else if (rect.right > bounds.right) dx = bounds.right - rect.right
    let dy = 0
    if (rect.top < bounds.top) dy = bounds.top - rect.top
    else if (rect.bottom > bounds.bottom) dy = bounds.bottom - rect.bottom
    setClampStyle(dx !== 0 || dy !== 0 ? { transform: `translate(${dx}px, ${dy}px)` } : undefined)
  }

  useLayoutEffect(() => {
    if (!open) { setClampStyle(undefined); return }
    recomputeRef.current()
    const onResize = () => recomputeRef.current()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return clampStyle
}
