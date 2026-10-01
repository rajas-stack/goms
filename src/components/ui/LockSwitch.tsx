import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

/** Tap-toggle switch for a Lock / Unlock editing mode. Not a draggable slider —
 *  a single tap flips locked/unlocked, and the icon bubble animates sliding
 *  across the pill via `framer-motion`'s `layout` animation, which is what
 *  reads as a "slide" without needing pointer-drag handling. Shared by the
 *  Sales Team lock and the Bid Tracker Master Grid lock so they look and
 *  behave identically. */
export function LockSwitch({ unlocked, onToggle, lockedLabel, unlockedLabel, className }: {
  unlocked: boolean
  onToggle: () => void
  /** Accessible names for each state (what tapping would do). */
  lockedLabel: string
  unlockedLabel: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={unlocked}
      aria-label={unlocked ? unlockedLabel : lockedLabel}
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
