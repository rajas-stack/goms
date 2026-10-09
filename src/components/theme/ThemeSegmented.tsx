import { useId } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { originOf, useTheme, type ThemePreference } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { setEyeComfort, useEyeComfort } from './EyeComfort'

export const THEME_OPTIONS: readonly { value: ThemePreference | 'comfort'; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: 'Sun' },
  { value: 'dark', label: 'Dark', icon: 'Moon' },
  { value: 'comfort', label: 'Eye comfort', icon: 'ShieldCheck' },
]

interface Props {
  /** `menu` renders `menuitemradio`s (inside the Options dropdown, so arrow
   *  keys reach them); `radio` is a standalone radiogroup. */
  variant?: 'menu' | 'radio'
}

/** Theme selection and adjustable warmth, retaining the current base theme. */
export function ThemeSegmented({ variant = 'radio' }: Props) {
  const { resolved, setPreference } = useTheme()
  const comfort = useEyeComfort()
  const pillId = useId()
  const itemRole = variant === 'menu' ? 'menuitemradio' : 'radio'

  return (
    <><div
      role={variant === 'menu' ? 'group' : 'radiogroup'}
      aria-label="Theme"
      className="grid grid-cols-3 gap-0.5 rounded-xl bg-ink-900/[0.05] p-[3px]"
    >
      {THEME_OPTIONS.map((opt) => {
        const active = opt.value === 'comfort' ? comfort.enabled : !comfort.enabled && resolved === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role={itemRole}
            aria-checked={active}
            onClick={(e) => {
              if (opt.value === 'comfort') setEyeComfort({ enabled: true })
              else { setEyeComfort({ enabled: false }); setPreference(opt.value, originOf(e.currentTarget)) }
            }}
            className={cn(
              'relative flex h-9 items-center justify-center gap-1 rounded-[9px] text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo/60 lg:h-8',
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
    {comfort.enabled && <label className="mt-3 flex items-center gap-3 px-1 text-xs text-ink" htmlFor={`${pillId}-comfort`}>
      <Icon name="ShieldCheck" size={15} />
      <input id={`${pillId}-comfort`} aria-label="Eye comfort strength" className="min-w-0 flex-1 accent-ink-700" type="range" min="0" max="100" step="1" value={comfort.strength} onChange={event => setEyeComfort({ strength: Number(event.target.value) })} />
      <span className="w-8 text-right tabular-nums">{comfort.strength}%</span>
    </label>}</>
  )
}
