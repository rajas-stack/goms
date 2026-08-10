import { motion } from 'framer-motion'
import { useSalesEditLock } from './salesEditLock'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

/** Tap-toggle switch for `SalesEditLockProvider`. Not a draggable slider —
 *  a single tap flips locked/unlocked, and the icon bubble animates sliding
 *  across the pill via `framer-motion`'s `layout` animation, which is what
 *  reads as a "slide" without needing pointer-drag handling. */
export function SalesEditLockToggle({ className }: { className?: string }) {
  const { unlocked, toggle } = useSalesEditLock()

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={unlocked}
      aria-label={unlocked ? 'Sales team editing unlocked — tap to lock' : 'Sales team editing locked — tap to unlock'}
      className={cn(
        'relative flex h-7 w-[104px] shrink-0 items-center rounded-full border px-1 text-[11px] font-medium transition-colors',
        unlocked ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-line bg-panel text-muted',
        className,
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 34 }}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white shadow-sm',
          unlocked ? 'order-2' : 'order-1',
        )}
      >
        <Icon name={unlocked ? 'Unlock' : 'Lock'} size={12} />
      </motion.span>
      <span className={cn('flex-1 text-center', unlocked ? 'order-1' : 'order-2')}>
        {unlocked ? 'Unlocked' : 'Locked'}
      </span>
    </button>
  )
}
