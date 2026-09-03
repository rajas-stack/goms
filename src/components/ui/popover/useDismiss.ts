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
      const target = e.target as HTMLElement
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
      // A popover nested inside this one (e.g. a Combobox's own dropdown
      // opened from within this panel) portals to `document.body` as a
      // sibling, not a DOM descendant of `panelRef` — so without this check,
      // clicking an option in it would read as "outside" and close this
      // panel out from under it. `data-popover-panel` (PopoverPanel.tsx's own
      // portaled wrapper) marks exactly this, and only this — root-caused
      // 2026-09-03: this used to check the much broader `data-canvas-ui`,
      // which Dialog.tsx's full-screen wrapper *also* carries (for an
      // unrelated reason — HierarchyCanvas's own click-outside-deselects-node
      // guard). Since that wrapper is an ancestor of literally everything
      // while any dialog is open, every popover using this hook (Combobox,
      // MultiSelectDropdown, Menu, ManagerPicker, EmployeePicker,
      // DepartmentCombobox) could never be dismissed by an outside click
      // inside a dialog — only Escape or re-toggling its own trigger worked.
      if (target.closest?.('[data-popover-panel]')) return
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
