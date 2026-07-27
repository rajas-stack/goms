import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react'

interface UseRovingIndexOptions {
  count: number
  /** Active index resets to 0 whenever this value changes (e.g. a
   *  `${query}:${open}` string). */
  resetKey: unknown
  onCommit: (index: number) => void
  containerRef: RefObject<HTMLElement | null>
}

interface RovingIndex {
  active: number
  setActive: (index: number) => void
  /** Handles ArrowUp/ArrowDown/Home/End/Enter. Returns whether it handled
   *  the key, so callers can special-case keys it doesn't own (e.g. opening
   *  a closed popup on the first ArrowDown). */
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => boolean
}

/** Keyboard-navigable active index over a rendered list. Each row marks
 *  itself with `data-roving-index={i}` inside `containerRef` so the active
 *  row can be scrolled into view as it changes. */
export function useRovingIndex({ count, resetKey, onCommit, containerRef }: UseRovingIndexOptions): RovingIndex {
  const [active, setActive] = useState(0)

  useEffect(() => setActive(0), [resetKey])
  useEffect(() => { if (active > count - 1) setActive(Math.max(0, count - 1)) }, [count, active])

  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-roving-index="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, containerRef])

  function onKeyDown(e: KeyboardEvent<HTMLElement>): boolean {
    if (count === 0) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, count - 1)); return true }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return true }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); return true }
    if (e.key === 'End') { e.preventDefault(); setActive(count - 1); return true }
    if (e.key === 'Enter') { e.preventDefault(); onCommit(active); return true }
    return false
  }

  return { active, setActive, onKeyDown }
}
