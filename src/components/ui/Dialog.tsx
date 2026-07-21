import { type ReactNode, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from './Icon'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg' | 'xl'
}

const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    // This wrapper is always mounted (never gated behind AnimatePresence)
    // specifically so `pointer-events` tracks the *live* `open` value: once
    // closed, the whole overlay stops intercepting clicks/hover immediately,
    // even while the backdrop/content below are still mid exit-fade. Without
    // this, the exiting backdrop keeps its full-screen onClick={onClose}
    // active for the whole fade-out duration, silently swallowing whatever
    // the user clicks next.
    <div
      data-canvas-ui
      className={cn(
        'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
    >
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 bg-ink-900/40 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className={cn('relative mt-8 w-full rounded-2xl border border-line bg-paper shadow-pop', SIZE_CLASS[size])}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            >
              <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
                  {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="rounded-md p-1 text-muted hover:bg-ink-900/[0.06] hover:text-ink"
                >
                  <Icon name="X" />
                </button>
              </div>
              <div className="px-6 py-5">{children}</div>
              {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
