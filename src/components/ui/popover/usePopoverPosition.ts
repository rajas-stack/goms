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

      setPosition({ top, left, width: matchAnchorWidth ? a.width : undefined, maxHeight })
    }

    recompute()
    // The panel mounts with the previous frame's (often empty) content, so
    // its `scrollHeight` on the very first measurement can read as 0 — a
    // second pass next frame measures the real, populated content.
    const raf = requestAnimationFrame(recompute)
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
