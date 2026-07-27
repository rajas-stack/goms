import { useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { PopoverPanel } from './popover/PopoverPanel'
import { useMenuKeyboardNav } from './popover/useMenuKeyboardNav'

interface MenuProps {
  /** Render prop for the trigger. Call `toggle` to open/close; `open` reflects state. */
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
  /** Menu items. Receives `close` so item handlers can dismiss the menu. */
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'start' | 'end'
  className?: string
}

/**
 * Lightweight overflow menu. Closes on outside click and Escape, and
 * supports arrow-key/Home/End navigation between its `MenuItem`s.
 * Used to tuck destructive / secondary actions away from primary buttons.
 */
export function Menu({ trigger, children, align = 'end', className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelContentRef = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)

  useMenuKeyboardNav(open, panelContentRef)

  return (
    <div ref={anchorRef} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      <PopoverPanel open={open} anchorRef={anchorRef} onClose={close} align={align} maxPanelHeight={400}>
        {({ maxHeight }) => (
          <motion.div
            ref={panelContentRef}
            data-canvas-ui
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            style={{ maxHeight }}
            className={cn(
              'min-w-[11rem] overflow-y-auto scrollbar-thin rounded-xl border border-line bg-paper p-1 shadow-pop',
              className,
            )}
          >
            {typeof children === 'function' ? children(close) : children}
          </motion.div>
        )}
      </PopoverPanel>
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
        'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors focus-visible:focus-ring disabled:opacity-40 disabled:pointer-events-none lg:min-h-0',
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
