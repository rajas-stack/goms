import { useLayoutEffect, useState, type RefObject } from 'react'

const EDGE_PAD = 8

interface PopoverPositionOptions {
  open: boolean
  anchorRef: RefObject<HTMLElement>
  panelRef: RefObject<HTMLElement>
  matchAnchorWidth?: boolean
  align?: 'start' | 'end'
  maxPanelHeight?: number
  gap?: number
}

interface PopoverPosition {
  top: number
  left: number
  width?: number
  maxHeight: number
}

/** Computes a `position: fixed` box anchored to `anchorRef`: opens below by
 *  default, flips above when there isn't room below (and there's more room
 *  above), clamps horizontally into the viewport, and caps height to
 *  whatever space is actually available in the chosen direction. Recomputes
 *  on open, window resize, and any ancestor scroll (capture-phase, since
 *  `scroll` doesn't bubble) so the panel tracks its anchor. */
const near = (a: number, b: number) => Math.abs(a - b) < 0.5
function samePosition(a: PopoverPosition, b: PopoverPosition): boolean {
  return near(a.top, b.top) && near(a.left, b.left) && near(a.maxHeight, b.maxHeight)
    && (a.width === undefined) === (b.width === undefined) && (a.width === undefined || near(a.width, b.width as number))
}

export function usePopoverPosition({
  open, anchorRef, panelRef, matchAnchorWidth = false, align = 'start', maxPanelHeight = 320, gap = 4,
}: PopoverPositionOptions): PopoverPosition {
  const [position, setPosition] = useState<PopoverPosition>({ top: -9999, left: -9999, maxHeight: maxPanelHeight })

  useLayoutEffect(() => {
    if (!open) return

    function recompute() {
      const anchor = anchorRef.current
      if (!anchor) return
      const panel = panelRef.current
      const a = anchor.getBoundingClientRect()
      const naturalWidth = matchAnchorWidth ? a.width : Math.max(panel?.scrollWidth ?? 0, a.width)
      const naturalHeight = panel?.scrollHeight ?? maxPanelHeight

      const spaceBelow = window.innerHeight - a.bottom - gap - EDGE_PAD
      const spaceAbove = a.top - gap - EDGE_PAD
      const openUpward = naturalHeight > spaceBelow && spaceAbove > spaceBelow

      const maxHeight = Math.max(80, Math.min(maxPanelHeight, openUpward ? spaceAbove : spaceBelow))
      const top = openUpward ? a.top - gap - Math.min(naturalHeight, maxHeight) : a.bottom + gap

      let left = align === 'end' ? a.right - naturalWidth : a.left
      left = Math.min(Math.max(left, EDGE_PAD), window.innerWidth - naturalWidth - EDGE_PAD)

      const next: PopoverPosition = { top, left, width: matchAnchorWidth ? a.width : undefined, maxHeight }
      // The rAF loop below runs for as long as the panel is open. Setting state with a
      // fresh object every frame re-rendered the whole popover subtree at 60 Hz even when
      // nothing had moved — with two popovers open over a large grid (the Bid Tracker
      // filter bar) that saturated the main thread for seconds. Only update on a real change
      // (sub-pixel jitter ignored).
      setPosition((prev) => (samePosition(prev, next) ? prev : next))
    }

    // The anchor can still be moving when this fires — e.g. a parent Dialog's
    // entrance spring is still animating, or the panel's own first-frame
    // content measures as 0 before layout settles. A single extra rAF pass
    // used to be the fix, but that only catches a one-frame delay: anything
    // slower (a spring transition runs for several hundred ms) left the panel
    // stuck in its wrong first position until a `scroll` event happened to
    // force a recompute. Track continuously via rAF for as long as the panel
    // is open instead, so it always reflects the anchor's current position.
    let raf = requestAnimationFrame(function loop() {
      recompute()
      raf = requestAnimationFrame(loop)
    })
    window.addEventListener('resize', recompute)
    window.addEventListener('scroll', recompute, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll', recompute, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return position
}
