import { LockSwitch } from '@/components/ui/LockSwitch'
import { useSalesEditLock } from './salesEditLock'

/** Tap-toggle switch for `SalesEditLockProvider` — see `LockSwitch` for the look. */
export function SalesEditLockToggle({ className }: { className?: string }) {
  const { unlocked, toggle } = useSalesEditLock()
  return (
    <LockSwitch
      unlocked={unlocked} onToggle={toggle} className={className}
      lockedLabel="Sales team editing locked — tap to unlock"
      unlockedLabel="Sales team editing unlocked — tap to lock"
    />
  )
}
