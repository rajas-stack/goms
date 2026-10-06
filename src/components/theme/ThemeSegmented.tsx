import { useId } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { originOf, useTheme, type ThemePreference } from '@/lib/theme'
import { cn } from '@/lib/utils'

export const THEME_OPTIONS: readonly { value: ThemePreference; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: 'Sun' },
  { value: 'dark', label: 'Dark', icon: 'Moon' },
  { value: 'system', label: 'System', icon: 'Monitor' },
]

interface Props {
  /** `menu` renders `menuitemradio`s (inside the Options dropdown, so arrow
   *  keys reach them); `radio` is a standalone radiogroup. */
  variant?: 'menu' | 'radio'
}

/** Light / Dark / System picker with a pill that slides to the active
 *  choice. Picking one reveals the new theme from the clicked segment. */
export function ThemeSegmented({ variant = 'radio' }: Props) {
  const { preference, setPreference } = useTheme()
  const pillId = useId()
  const itemRole = variant === 'menu' ? 'menuitemradio' : 'radio'

  return (
    <div
      role={variant === 'menu' ? 'group' : 'radiogroup'}
      aria-label="Theme"
      className="grid grid-cols-3 gap-0.5 rounded-xl bg-ink-900/[0.05] p-[3px]"
    >
      {THEME_OPTIONS.map((opt) => {
        const active = preference === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role={itemRole}
            aria-checked={active}
            onClick={(e) => setPreference(opt.value, originOf(e.currentTarget))}
            className={cn(
              'relative flex h-9 items-center justify-center gap-1.5 rounded-[9px] text-[12.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo/60 lg:h-8',
              active ? 'text-ink-900' : 'text-muted hover:text-ink',
            )}
          >
            {active && (
              <motion.span
                layoutId={pillId}
                className="absolute inset-0 rounded-[9px] bg-white shadow-[0_1px_2px_rgb(var(--c-shadow)/0.12),0_0_0_1px_rgb(var(--c-line))]"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <Icon name={opt.icon} size={14} />
              {opt.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
