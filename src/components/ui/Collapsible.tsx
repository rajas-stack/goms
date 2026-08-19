import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from './Icon'
import { cn } from '@/lib/utils'

/** A titled, chevron-toggled section — collapse/expand is local UI state
 *  only and never touches whatever data `children` renders (2026-08-19
 *  pricing overhaul spec §6/§8: keeps a large BOQ page compact without
 *  ever risking losing state). */
export function Collapsible({ title, defaultOpen = true, icon, badge, children, className }: {
  title: string
  defaultOpen?: boolean
  icon?: string
  badge?: ReactNode
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={cn('rounded-2xl border border-line bg-white p-4 shadow-sm', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mb-0 flex w-full items-center gap-2 text-left"
      >
        {icon && <Icon name={icon} size={16} className="text-ink-700" />}
        <h2 className="flex-1 text-[13px] font-semibold uppercase tracking-wide text-ink-800">{title}</h2>
        {badge}
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={16} className="text-muted" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
