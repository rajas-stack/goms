import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

/** Keeps `#section-*` jump targets from landing underneath the sticky
 *  workspace header + section-nav bar when a nav button calls
 *  `scrollIntoView({ block: 'start' })` — without this, `block: 'start'`
 *  aligns a section's top edge with the scroll container's top edge, which
 *  is exactly where the sticky bar visually sits once stuck, hiding the
 *  section's first control underneath it. Setting `scroll-padding-top` on
 *  the scroll container shifts every such scroll down by the sticky bar's
 *  real measured height, so it stays correct even if the bar's height
 *  changes (e.g. wraps to a second line on a narrow viewport) — no
 *  hardcoded pixel value to keep in sync with the header design. */
export function useStickyScrollOffset(
  scrollRef: RefObject<HTMLElement | null>,
  stickyRef: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current
    const stickyEl = stickyRef.current
    if (!scrollEl || !stickyEl) return

    function apply() {
      if (!scrollEl || !stickyEl) return
      scrollEl.style.scrollPaddingTop = `${stickyEl.getBoundingClientRect().height}px`
    }
    apply()

    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [scrollRef, stickyRef])
}
