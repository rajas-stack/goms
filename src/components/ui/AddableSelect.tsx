import { useState } from 'react'
import { Select, Input } from './Field'
import { Button } from './Button'
import { Icon } from './Icon'
import { Dialog } from './Dialog'
import { useCustomOptions } from '@/lib/custom-options'
import { cn } from '@/lib/utils'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Built-in options, in display order. */
  options: string[]
  /** localStorage namespace for options a user adds via the "+" button. */
  storageKey: string
  className?: string
}

/** A <Select> plus a "+" button that opens a small popup for adding a new
 *  option not already in the list. Additions persist (localStorage, keyed by
 *  `storageKey`) so they're there again next time, for every dropdown backed
 *  by the same key. */
export function AddableSelect({ value, onChange, options, storageKey, className }: Props) {
  const [custom, addOption] = useCustomOptions(storageKey)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const merged = [...options, ...custom.filter((c) => !options.some((o) => o.toLowerCase() === c.toLowerCase()))]
  const withCurrent = value && !merged.some((o) => o.toLowerCase() === value.toLowerCase()) ? [value, ...merged] : merged

  function openPopup() {
    setDraft('')
    setOpen(true)
  }

  function save() {
    const trimmed = draft.trim()
    if (!trimmed) return
    const existing = withCurrent.find((o) => o.toLowerCase() === trimmed.toLowerCase())
    onChange(existing ?? addOption(trimmed))
    setOpen(false)
  }

  return (
    <>
      <div className={cn('relative', className)}>
        <Select value={value} onChange={(e) => onChange(e.target.value)} className="pr-9">
          {withCurrent.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
        <button
          type="button"
          aria-label="Add option"
          onClick={openPopup}
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted transition-colors hover:bg-ink-900/[0.06] hover:text-ink"
        >
          <Icon name="Plus" size={14} />
        </button>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add option"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!draft.trim()}>Save</Button>
          </>
        }
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. New option"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); save() }
          }}
        />
      </Dialog>
    </>
  )
}
