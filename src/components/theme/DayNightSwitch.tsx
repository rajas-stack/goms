import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

// Sky gradients are the one place colors are fixed per theme rather than
// tokenized: the track *depicts* day or night, whatever the app is showing.
const DAY_SKY = 'linear-gradient(135deg, #FFD89B 0%, #A8D8F8 100%)'
const NIGHT_SKY = 'linear-gradient(135deg, #27306B 0%, #0B1024 100%)'
const STARS = [
  { left: '18%', top: '28%', size: 2, delay: 0.05 },
  { left: '32%', top: '62%', size: 1.5, delay: 0.12 },
  { left: '44%', top: '22%', size: 1.5, delay: 0.18 },
]
const SPRING = { type: 'spring', stiffness: 520, damping: 34 } as const

interface Props {
  isNight: boolean
  className?: string
}

/** Purely visual day/night track — the interactive element (and its
 *  `aria-checked`) is the row that renders it, so the whole row is the hit
 *  target rather than a 52px pill. */
export function DayNightSwitch({ isNight, className }: Props) {
  return (
    <span
      aria-hidden
      className={cn('relative inline-flex h-7 w-[52px] shrink-0 overflow-hidden rounded-full shadow-[inset_0_1px_3px_rgba(0,0,0,0.25)]', className)}
    >
      <motion.span className="absolute inset-0" style={{ background: DAY_SKY }} animate={{ opacity: isNight ? 0 : 1 }} transition={{ duration: 0.3 }} />
      <motion.span className="absolute inset-0" style={{ background: NIGHT_SKY }} animate={{ opacity: isNight ? 1 : 0 }} transition={{ duration: 0.3 }} />
      {STARS.map((s) => (
        <motion.span
          key={`${s.left}-${s.top}`}
          className="absolute rounded-full bg-[#F4F1DE]"
          style={{ left: s.left, top: s.top, width: s.size, height: s.size }}
          animate={{ opacity: isNight ? 1 : 0, scale: isNight ? 1 : 0.2 }}
          transition={{ duration: 0.25, delay: isNight ? s.delay : 0 }}
        />
      ))}
      <motion.span
        className="absolute top-[3px] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#FFFDF6] shadow-[0_2px_6px_rgba(0,0,0,0.3)]"
        initial={false}
        animate={{ x: isNight ? 27 : 3 }}
        transition={SPRING}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={isNight ? 'moon' : 'sun'}
            className={cn('flex', isNight ? 'text-[#4B55A8]' : 'text-[#E08A1E]')}
            initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            <Icon name={isNight ? 'Moon' : 'Sun'} size={13} />
          </motion.span>
        </AnimatePresence>
      </motion.span>
    </span>
  )
}
