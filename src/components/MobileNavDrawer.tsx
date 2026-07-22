import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useShell } from '@/app/AppLayout'
import { Icon } from './ui/Icon'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
}

/** Mobile-only hamburger drawer, triggered from TopBar's menu button. It
 *  doesn't own any dialogs itself — it just surfaces the same Search/Import
 *  actions TopBar already exposes via `useShell()`; the CommandPalette and
 *  ImportDialog it opens stay mounted once, in AppLayout. */
export function MobileNavDrawer({ open, onClose }: Props) {
  const { openSearch, openImport } = useShell()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    // Always mounted (see ui/Dialog.tsx for why) so pointer-events tracks
    // the live `open` value instead of lingering through the exit fade.
    <div
      data-canvas-ui
      className={cn('fixed inset-0 z-50 lg:hidden', open ? 'pointer-events-auto' : 'pointer-events-none')}
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
              aria-label="Menu"
              className="fixed inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col gap-1 border-r border-line bg-paper p-3 shadow-pop"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 32 }}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="font-display text-sm font-semibold text-ink-900">Menu</span>
                <button
                  onClick={onClose}
                  aria-label="Close menu"
                  className="flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-ink-900/[0.06] hover:text-ink"
                >
                  <Icon name="X" size={18} />
                </button>
              </div>
              <button
                onClick={() => {
                  onClose()
                  openSearch()
                }}
                className="flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-ink hover:bg-ink-900/[0.05]"
              >
                <Icon name="Search" size={17} />
                Search
              </button>
              <button
                onClick={() => {
                  onClose()
                  openImport()
                }}
                className="flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-ink hover:bg-ink-900/[0.05]"
              >
                <Icon name="Upload" size={17} />
                Import records
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
