import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useClampToAncestor } from './useClampToAncestor'

interface MenuProps {
  /** Render prop for the trigger. Call `toggle` to open/close; `open` reflects state. */
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
  /** Menu items. Receives `close` so item handlers can dismiss the menu. */
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'start' | 'end'
  className?: string
}

/**
 * Lightweight overflow menu. Closes on outside click and Escape.
 * Used to tuck destructive / secondary actions away from primary buttons.
 */
export function Menu({ trigger, children, align = 'end', className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const clampStyle = useClampToAncestor(open, popupRef)
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      <AnimatePresence>
        {open && (
          <div
            ref={popupRef}
            className={cn('absolute z-40 mt-1.5', align === 'end' ? 'right-0' : 'left-0')}
            style={clampStyle}
          >
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className={cn(
                'min-w-[11rem] overflow-hidden rounded-xl border border-line bg-paper p-1 shadow-pop',
                className,
              )}
            >
              {typeof children === 'function' ? children(close) : children}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface MenuItemProps {
  icon?: ReactNode
  children: ReactNode
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  className?: string
}

export function MenuItem({ icon, children, onClick, danger, disabled, className }: MenuItemProps) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none',
        danger ? 'text-crimson hover:bg-crimson-100' : 'text-ink hover:bg-ink-900/[0.05]',
        className,
      )}
    >
      {icon && <span className="shrink-0 text-muted">{icon}</span>}
      <span className="flex-1">{children}</span>
    </button>
  )
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-line" />
}
