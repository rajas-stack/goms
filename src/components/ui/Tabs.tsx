import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 border-b border-line">
      {tabs.map((t) => {
        const active = t.value === value
        return (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            className={cn(
              'relative px-3 py-2 text-[13px] font-medium transition-colors',
              active ? 'text-ink-900' : 'text-muted hover:text-ink',
            )}
          >
            {t.label}
            {active && (
              <motion.span
                layoutId="tab-underline"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-indigo"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
