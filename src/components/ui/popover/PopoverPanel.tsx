import { useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Portal } from './Portal'
import { usePopoverPosition } from './usePopoverPosition'
import { useDismiss } from './useDismiss'

interface PopoverPanelProps {
  open: boolean
  anchorRef: RefObject<HTMLElement>
  onClose: () => void
  /** Panel width tracks the anchor's width exactly (typeahead selects). When
   *  false, the panel sizes to its own content (menus, canvas pickers). */
  matchAnchorWidth?: boolean
  /** Horizontal alignment against the anchor when not matching its width. */
  align?: 'start' | 'end'
  maxPanelHeight?: number
  gap?: number
  /** Render prop so the caller's own scrollable/animated element receives the
   *  computed `maxHeight` — this wrapper only positions; it never scrolls or
   *  paints a background itself, so every consumer keeps its exact existing
   *  visual styling and animation. */
  children: (position: { style: CSSProperties; maxHeight: number }) => ReactNode
}

/** Anchors `children` to `anchorRef` via a `document.body` portal + fixed
 *  positioning — immune to any ancestor's `overflow`/`z-index`/stacking
 *  context (unlike the old `absolute` + ancestor-clamp approach). Flips
 *  above the anchor when there isn't room below, clamps horizontally into
 *  the viewport, and re-measures on scroll/resize while open. Also owns
 *  outside-click/Escape dismissal (`useDismiss`) since the panel no longer
 *  lives inside the anchor's DOM subtree once portaled. */
export function PopoverPanel({
  open, anchorRef, onClose, matchAnchorWidth = false, align = 'start', maxPanelHeight = 320, gap = 4, children,
}: PopoverPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const position = usePopoverPosition({ open, anchorRef, panelRef, matchAnchorWidth, align, maxPanelHeight, gap })
  useDismiss({ open, onClose, anchorRef, panelRef })

  return (
    <AnimatePresence>
      {open && (
        <Portal>
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: position.top, left: position.left, width: position.width, zIndex: 65 }}
          >
            {children({ style: { maxHeight: position.maxHeight }, maxHeight: position.maxHeight })}
          </div>
        </Portal>
      )}
    </AnimatePresence>
  )
}
