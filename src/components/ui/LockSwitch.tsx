import { useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import './LockSwitch.css'

interface LockSwitchProps {
  unlocked: boolean
  onToggle: () => void
  /** Accessible names describe the action available in each state. */
  lockedLabel: string
  unlockedLabel: string
  className?: string
  disabled?: boolean
  /** Compact controls retain their action in the tooltip and accessible name. */
  size?: 'md' | 'sm' | 'toolbar'
  /** Explicit action copy for passphrase and confirmation buttons. */
  text?: string
}

/** The caller controls the state, including any passphrase or permission checks. */
export function LockSwitch({
  unlocked, onToggle, lockedLabel, unlockedLabel, className,
  disabled = false, size = 'md', text,
}: LockSwitchProps) {
  const [keyboardAction, setKeyboardAction] = useState(false)
  const label = unlocked ? unlockedLabel : lockedLabel
  const iconOnly = size !== 'md'

  return (
    <button
      type="button"
      onClick={onToggle}
      onPointerDown={() => setKeyboardAction(false)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setKeyboardAction(true) }}
      disabled={disabled}
      aria-pressed={unlocked}
      aria-label={label}
      title={iconOnly ? label : undefined}
      data-unlocked={unlocked}
      data-instant={keyboardAction}
      className={cn(
        'lock-switch focus-visible:focus-ring',
        size === 'sm' && 'lock-switch--compact',
        size === 'toolbar' && 'lock-switch--toolbar',
        className,
      )}
    >
      <span aria-hidden="true" className="lock-switch__track" />
      <span aria-hidden="true" className="lock-switch__shine" />
      <span aria-hidden="true" className="lock-switch__label">
        <Icon name={unlocked ? 'Unlock' : 'Lock'} size={size === 'sm' ? 10 : size === 'toolbar' ? 12 : 13} />
        {!iconOnly && <span>{text ?? (unlocked ? 'Unlocked' : 'Locked')}</span>}
      </span>
      <span aria-hidden="true" className="lock-switch__thumb" />
    </button>
  )
}
