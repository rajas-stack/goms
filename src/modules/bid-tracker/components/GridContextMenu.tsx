import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

export interface MenuEntry {
  label: string
  icon?: string
  onSelect: () => void
  disabled?: boolean
  /** Destructive: drawn in red. */
  danger?: boolean
}

/** A right-click menu at the pointer: groups of actions separated by a rule. Closes
 *  on Escape, an outside click, scroll or resize. Keyboard: ↑/↓ and Enter. */
export function GridContextMenu({ x, y, title, groups, onClose }: {
  x: number
  y: number
  /** What was clicked (read by screen readers). */
  title: string
  groups: MenuEntry[][]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const flat = groups.flat()
  const [active, setActive] = useState(() => Math.max(0, flat.findIndex((e) => !e.disabled)))

  // Keep the menu inside the window: flip left / up when it would overflow.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - (width || 220) - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - (height || 240) - 8)),
    })
  }, [x, y])

  useEffect(() => {
    ref.current?.focus()
    const close = () => onClose()
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('contextmenu', onDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('contextmenu', onDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  const run = (entry: MenuEntry | undefined) => {
    if (!entry || entry.disabled) return
    onClose()
    entry.onSelect()
  }
  const step = (delta: 1 | -1) => {
    let i = active
    for (let n = 0; n < flat.length; n++) {
      i = (i + delta + flat.length) % flat.length
      if (!flat[i].disabled) break
    }
    setActive(i)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); run(flat[active]) }
  }

  let index = -1
  return createPortal(
    <div
      ref={ref} role="menu" aria-label={title} tabIndex={-1} onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 80 }}
      className="w-60 rounded-xl border border-line bg-paper p-1 shadow-pop outline-none"
      data-testid="grid-context-menu"
    >
      {groups.filter((g) => g.length).map((group, gi) => (
        <div key={gi} className={cn(gi > 0 && 'mt-1 border-t border-line pt-1')}>
          {group.map((entry) => {
            index += 1
            const i = index
            return (
              <button
                key={entry.label} type="button" role="menuitem" disabled={entry.disabled}
                onMouseEnter={() => setActive(i)} onClick={() => run(entry)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] disabled:pointer-events-none disabled:opacity-40',
                  entry.danger ? 'text-crimson' : 'text-ink',
                  i === active && (entry.danger ? 'bg-crimson-100' : 'bg-goms-sky/[0.16]'),
                )}
              >
                {entry.icon && <Icon name={entry.icon} size={14} className="shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>,
    document.body,
  )
}
