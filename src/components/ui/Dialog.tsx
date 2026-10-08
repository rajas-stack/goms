import { type ReactNode, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from './Icon'
import { useMediaQuery } from '@/lib/useMediaQuery'
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

// `lg:`-prefixed so the max-width cap only ever applies at the desktop
// centered-modal breakpoint — below `lg` the sheet is intentionally
// full-bleed (see the mobile bottom-sheet variant below), not shrunk to one
// of these widths.
const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  md: 'lg:max-w-md',
  lg: 'lg:max-w-2xl',
  xl: 'lg:max-w-4xl',
}

export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: Props) {
  // Below `lg`, every dialog built on this component presents as a bottom
  // sheet (full-bleed width, anchored to the bottom edge, internal scroll
  // capped at 90vh) instead of the small centered modal — an additive
  // responsive variant. At `lg` and up the centered-modal markup/animation
  // below is untouched from before this change.
  const isMobile = useMediaQuery('(max-width: 1023.98px)')

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
        'fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 lg:items-start lg:p-8',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
    >
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 bg-scrim/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className={cn(
                'relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-paper shadow-pop lg:mt-8 lg:max-h-none lg:overflow-visible lg:rounded-2xl',
                SIZE_CLASS[size],
              )}
              initial={isMobile ? { opacity: 0, y: 48 } : { opacity: 0, y: 16, scale: 0.98 }}
              animate={isMobile ? { opacity: 1, y: 0 } : { opacity: 1, y: 0, scale: 1 }}
              exit={isMobile ? { opacity: 0, y: 48 } : { opacity: 0, y: 8, scale: 0.98 }}
              transition={isMobile ? { type: 'spring', stiffness: 340, damping: 32 } : { type: 'spring', stiffness: 320, damping: 28 }}
            >
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 py-4">
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
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 lg:overflow-visible">{children}</div>
              {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
