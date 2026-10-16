import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'

type Detail = { title: string; rows: [string, string][]; color?: string }
type Active = Detail & { key: string; anchor: Element; keyboard: boolean }
export const chartSpring = { type: 'spring' as const, stiffness: 300, damping: 25 }

// One tooltip per chart, anchored to the mark rather than the moving pointer.
export function useChartInteraction(scope: unknown) {
  const id = useId(), [active, setActive] = useState<Active | null>(null)
  const reduced = useReducedMotion()
  const activate = (next: Active) => {
    window.dispatchEvent(new CustomEvent('goms:chart-preview', { detail: id }))
    setActive(next)
  }
  useEffect(() => { setActive(null) }, [scope])
  useEffect(() => {
    if (!active) return
    const outside = (e: PointerEvent) => {
      const region = active.anchor.closest('.insight-frame, .insight-kpi, [data-chart-container]') ?? active.anchor
      if (e.target instanceof Node && !region.contains(e.target)) setActive(null)
    }
    window.addEventListener('pointerdown', outside, true)
    return () => window.removeEventListener('pointerdown', outside, true)
  }, [active])
  useEffect(() => {
    const clear = () => setActive(null)
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') clear() }
    const preview = (e: Event) => { if ((e as CustomEvent<string>).detail !== id) clear() }
    window.addEventListener('scroll', clear, true)
    window.addEventListener('resize', clear)
    window.addEventListener('blur', clear)
    window.addEventListener('keydown', escape)
    window.addEventListener('goms:chart-preview', preview)
    return () => {
      window.removeEventListener('scroll', clear, true)
      window.removeEventListener('resize', clear)
      window.removeEventListener('blur', clear)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('goms:chart-preview', preview)
    }
  }, [id])
  const bind = (key: string, detail: Detail) => ({
    'data-chart-active': active?.key === key ? 'true' : undefined,
    'data-chart-muted': active && active.key !== key ? 'true' : undefined,
    'aria-describedby': active?.key === key ? id : undefined,
    onPointerEnter: (e: ReactPointerEvent<Element>) => {
      if (e.pointerType !== 'touch') activate({ ...detail, key, anchor: e.currentTarget, keyboard: false })
    },
    onPointerDown: (e: ReactPointerEvent<Element>) => {
      if (e.pointerType === 'touch') activate({ ...detail, key, anchor: e.currentTarget, keyboard: false })
    },
    onPointerLeave: (e: ReactPointerEvent<Element>) => {
      if (document.activeElement !== e.currentTarget) setActive(null)
    },
    onFocus: (e: { currentTarget: Element }) => activate({ ...detail, key, anchor: e.currentTarget, keyboard: true }),
    onBlur: () => setActive(null),
    onKeyUp: (e: { key: string }) => { if (e.key === 'Escape') setActive(null) },
  })
  return {
    active: active?.key, tooltipId: id, bind, reduced,
    show: (key: string, anchor: Element, detail: Detail) => activate({ ...detail, key, anchor, keyboard: true }),
    clear: () => setActive(null),
    tooltip: active && createPortal(<ChartTooltip id={id} active={active} reduced={!!reduced}/>, document.body),
  }
}

function ChartTooltip({ id, active, reduced }: { id: string; active: Active; reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 224, ready: false, side: 'right' })
  useLayoutEffect(() => {
    const mark = active.anchor.getBoundingClientRect()
    const frame = (active.anchor.closest('.insight-frame, .insight-kpi, [data-chart-container]') ?? active.anchor).getBoundingClientRect()
    const plot = (active.anchor.closest('svg, .insight-bars, .insight-legacy-bar') ?? active.anchor).getBoundingClientRect()
    const width = Math.min(224, window.innerWidth - 16)
    const height = ref.current?.getBoundingClientRect().height ?? 96
    const plotRight = Math.min(plot.right, frame.right, window.innerWidth - 8), plotLeft = Math.max(8, plot.left, frame.left)
    let left: number, top = mark.top + mark.height / 2 - height / 2, side: string
    if (plotRight + 12 + width <= window.innerWidth - 8) { left = plotRight + 12; side = 'right' }
    else if (plotLeft - 12 - width >= 8) { left = plotLeft - 12 - width; side = 'left' }
    else {
      left = Math.max(8, Math.min(window.innerWidth - width - 8, plotLeft))
      const below = plot.bottom + 10, above = plot.top - height - 10
      if (below + height <= window.innerHeight - 8) { top = below; side = 'bottom' }
      else { top = above >= 8 ? above : window.innerHeight - height - 8; side = 'top' }
    }
    setPosition({ left, top: Math.max(8, Math.min(window.innerHeight - height - 8, top)), width, ready: true, side })
  }, [active, position.width])
  return <motion.div ref={ref} id={id} role="tooltip" className="insight-chart-tooltip" data-placement={position.side}
    style={{ left: position.left, top: position.top, width: position.width, visibility: position.ready ? 'visible' : 'hidden' }}
    initial={{ opacity: 0, scale: reduced || active.keyboard ? 1 : .92, y: reduced || active.keyboard ? 0 : 6 }}
    animate={{ opacity: 1, scale: 1, y: 0 }} transition={reduced || active.keyboard ? { duration: 0 } : chartSpring}>
    <strong><i style={{ background: active.color ?? '#155ad6' }}/>{active.title}</strong>
    <dl>{active.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </motion.div>
}
