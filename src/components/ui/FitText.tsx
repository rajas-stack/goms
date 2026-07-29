import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/** Shrinks its content's font-size just enough to keep it on one line inside
 *  whatever width it's given (e.g. a detail-panel value that would otherwise
 *  wrap an email/URL mid-word) — and grows it straight back to the ambient
 *  size the moment there's room again, so widening the sidebar undoes the
 *  shrink rather than leaving it stuck small. Re-measures on every resize of
 *  its own container via `ResizeObserver`, so it tracks a shrinking/growing
 *  sidebar live. */
export function FitText({ children, className }: { children: React.ReactNode; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const text = textRef.current
    if (!wrap || !text) return

    function fit() {
      if (!wrap || !text) return
      // Reset first so a widening container can grow back to full size
      // instead of ratcheting only smaller.
      text.style.fontSize = ''
      const available = wrap.clientWidth
      const natural = text.scrollWidth
      if (available <= 0 || natural <= available) return
      const base = parseFloat(getComputedStyle(text).fontSize)
      let size = base * Math.max(available / natural, 0.6)
      text.style.fontSize = `${size}px`
      // Font metrics don't scale perfectly linearly with font-size, so the
      // ratio above can slightly undershoot — verify and nudge down until it
      // actually fits. Never skip this: an email/URL silently losing its
      // last characters to the wrapper's overflow-hidden is worse than the
      // text reading a little small.
      for (let i = 0; i < 8 && text.scrollWidth > available; i++) {
        size *= 0.96
        text.style.fontSize = `${size}px`
      }
    }

    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [children])

  return (
    <div ref={wrapRef} className={cn('min-w-0 overflow-hidden', className)}>
      <span ref={textRef} className="inline-block max-w-full whitespace-nowrap">{children}</span>
    </div>
  )
}
