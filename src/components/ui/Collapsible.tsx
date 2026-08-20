import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from './Icon'
import { cn } from '@/lib/utils'

/** A titled, chevron-toggled section — collapse/expand is local UI state
 *  only and never touches whatever data `children` renders (2026-08-19
 *  pricing overhaul spec §6/§8: keeps a large BOQ page compact without
 *  ever risking losing state). Uncontrolled by default (`defaultOpen`);
 *  pass `open`/`onOpenChange` to let a parent force it open — e.g. a
 *  sticky header's "Preview" button (BOQ workbench spec §2) — while every
 *  other `Collapsible` on the page stays uncontrolled and unaffected. */
export function Collapsible({ title, defaultOpen = true, open: openProp, onOpenChange, icon, badge, children, className }: {
  title: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  icon?: string
  badge?: ReactNode
  children: ReactNode
  className?: string
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const open = openProp ?? internalOpen

  function toggle() {
    const next = !open
    if (onOpenChange) onOpenChange(next)
    else setInternalOpen(next)
  }

  return (
    <section className={cn('rounded-2xl border border-line bg-white p-4 shadow-sm', className)}>
      <button
        type="button"
        onClick={toggle}
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
