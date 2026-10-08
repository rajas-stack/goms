import { useEffect, type RefObject } from 'react'

/** Roving keyboard nav for `Menu`, whose items are arbitrary
 *  `role="menuitem"` children rather than a list this hook controls — it
 *  moves native focus between them instead of tracking a numeric index.
 *  Focuses the first item on open so arrow keys work immediately; Enter/
 *  Space activation is native `<button>` behavior, so it needs no handling
 *  here. */
export function useMenuKeyboardNav(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  /** Which descendants are navigable — widen it for menus that also hold
   *  `menuitemradio`/`menuitemcheckbox` controls. */
  itemSelector = '[role="menuitem"]',
) {
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      containerRef.current?.querySelector<HTMLButtonElement>(`${itemSelector}:not(:disabled)`)?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [open, containerRef, itemSelector])

  useEffect(() => {
    if (!open) return

    function items(): HTMLButtonElement[] {
      return Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>(`${itemSelector}:not(:disabled)`) ?? [])
    }
    function focusAt(els: HTMLButtonElement[], i: number) {
      if (els.length === 0) return
      els[((i % els.length) + els.length) % els.length]?.focus()
    }
    function onKeyDown(e: KeyboardEvent) {
      const els = items()
      if (els.length === 0) return
      const idx = els.indexOf(document.activeElement as HTMLButtonElement)
      if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(els, idx + 1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(els, idx - 1) }
      else if (e.key === 'Home') { e.preventDefault(); focusAt(els, 0) }
      else if (e.key === 'End') { e.preventDefault(); focusAt(els, els.length - 1) }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, containerRef, itemSelector])
}
