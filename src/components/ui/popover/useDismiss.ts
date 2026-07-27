import { useEffect, useRef, type RefObject } from 'react'

interface UseDismissOptions {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement>
  panelRef: RefObject<HTMLElement>
}

/** Closes on a pointerdown outside both the anchor and the (portaled) panel,
 *  or on Escape. Reads `onClose` through a ref so the listener doesn't need
 *  to be torn down and reattached every render — mirrors the live-ref
 *  pattern used for the hardware back-button bridge in `backButtonBridge.ts`. */
export function useDismiss({ open, onClose, anchorRef, panelRef }: UseDismissOptions) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
      onCloseRef.current()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, anchorRef, panelRef])
}
