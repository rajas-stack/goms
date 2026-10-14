import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { cn } from '@/lib/utils'

export interface FilterOption { value: string; label: string }

interface Props {
  label: string
  options: readonly FilterOption[]
  value: readonly string[]
  onChange: (next: string[]) => void
}

/** A filter button that opens a checklist popover; shows how many values are picked. */
export function FilterDropdown({ label, options, value, onChange }: Props) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const toggle = (option: string) => onChange(value.includes(option) ? value.filter(item => item !== option) : [...value, option])
  const active = value.length > 0

  return (
    <>
      <button ref={anchorRef} type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(current => !current)}
        className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors focus-visible:focus-ring',
          active ? 'border-goms-navy/40 bg-goms-navy/10 text-goms-navy' : 'border-line bg-white text-ink-800 hover:border-ink-600/50 hover:bg-panel')}>
        {label}
        {active && <span className="rounded-full bg-goms-navy px-1.5 text-[10.5px] font-semibold leading-4 text-paper">{value.length}</span>}
        <Icon name="ChevronDown" size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      <PopoverPanel open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} maxPanelHeight={300}>
        {({ maxHeight }) => (
          <motion.div role="group" aria-label={`${label} options`} data-canvas-ui style={{ maxHeight }}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.1 }}
            className="min-w-[14rem] max-w-[20rem] overflow-y-auto scrollbar-thin rounded-xl border border-line bg-paper p-1 shadow-pop">
            {options.length === 0 && <p className="px-2.5 py-2 text-[12px] text-muted">Nothing to filter by yet.</p>}
            {options.map(option => (
              <label key={option.value} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-ink hover:bg-ink-900/[0.05]">
                <input type="checkbox" checked={value.includes(option.value)} onChange={() => toggle(option.value)} className="h-4 w-4 accent-ink-900" />
                <span className="truncate">{option.label}</span>
              </label>
            ))}
            {active && (
              <button type="button" onClick={() => onChange([])}
                className="mt-1 flex w-full items-center gap-1.5 rounded-lg border-t border-line px-2.5 py-2 text-left text-[12px] font-medium text-muted hover:text-ink">
                <Icon name="X" size={12} /> Clear {label.toLowerCase()}
              </button>
            )}
          </motion.div>
        )}
      </PopoverPanel>
    </>
  )
}
