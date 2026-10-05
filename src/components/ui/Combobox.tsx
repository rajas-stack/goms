import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { Icon } from './Icon'
import { PopoverPanel } from './popover/PopoverPanel'
import { useRovingIndex } from './popover/useRovingIndex'
import { cn } from '@/lib/utils'
import { Avatar, type AvatarPerson } from './Avatar'

export interface ComboboxOption {
  value: string
  label: string
  searchText?: string
  /** When the option is a human, their face is shown beside the label. */
  person?: AvatarPerson
}

interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  /** Shown when nothing is selected. */
  placeholder?: string
  /** Accessible name for the control. */
  'aria-label'?: string
  className?: string
  /** Renders a read-only display of the current selection instead of the
   *  editable control — for fields auto-filled from another selection. */
  disabled?: boolean
}

/**
 * Typeahead select: an input that filters `options` as you type and commits a
 * value on pick. An empty value means nothing is selected (the placeholder
 * shows). Built on the same border/height tokens as Input/Select so it drops in
 * beside them. Closes on outside click / Escape; ↑/↓/Home/End move the active
 * option and Enter commits it.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className,
  disabled = false,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value])
  const selectedLabel = selected?.label ?? ''
  const selectedPerson = selected?.person

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => `${o.label} ${o.searchText ?? ''}`.toLowerCase().includes(q))
  }, [options, query])

  // Closed: the input shows the committed selection. Open: it shows whatever the
  // user is typing (starting blank), while the current selection surfaces as the
  // placeholder so it never looks like the filter was cleared.
  const shown = open ? query : selectedLabel
  const placeholderText = open && selectedLabel ? selectedLabel : placeholder

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  function commit(option: ComboboxOption) {
    onChange(option.value)
    setOpen(false)
    inputRef.current?.blur()
  }

  function clear() {
    onChange('')
    setOpen(false)
  }

  const roving = useRovingIndex({
    count: matches.length,
    resetKey: `${query}:${open}`,
    onCommit: (i) => { const opt = matches[i]; if (opt) commit(opt) },
    containerRef: listRef,
  })

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && !open) {
      e.preventDefault()
      setOpen(true)
      return
    }
    roving.onKeyDown(e)
  }

  if (disabled) {
    return (
      <div className={cn('flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-panel px-3 text-[13px] text-ink-700', selectedPerson && 'pl-1.5', className)}>
        {selectedPerson && <Avatar person={selectedPerson} size="xs" />}
        {selectedLabel || <span className="text-muted/70">{placeholder}</span>}
      </div>
    )
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div className="relative">
        {selectedPerson && !open && (
          <Avatar person={selectedPerson} size="xs" className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2" />
        )}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={shown}
          placeholder={placeholderText}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            'h-9 w-full rounded-lg border border-line bg-white pl-3 pr-8 text-[13px] text-ink placeholder:text-muted/70 transition-colors focus:border-ink-600 focus-visible:focus-ring',
            selectedPerson && !open && 'pl-9',
          )}
          {...aria}
        />
        {value && !open ? (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={clear}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition-colors hover:text-ink-900"
          >
            <Icon name="X" size={13} />
          </button>
        ) : (
          <Icon
            name="ChevronDown"
            size={14}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
        )}
      </div>

      <PopoverPanel open={open} anchorRef={rootRef} onClose={() => setOpen(false)} matchAnchorWidth maxPanelHeight={240}>
        {({ maxHeight }) => (
          <motion.ul
            ref={listRef}
            role="listbox"
            data-canvas-ui
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            style={{ maxHeight }}
            className="w-full overflow-y-auto scrollbar-thin rounded-xl border border-line bg-paper p-1 shadow-pop"
          >
            {matches.length === 0 ? (
              <li className="px-2.5 py-2 text-[13px] text-muted">No matches</li>
            ) : (
              matches.map((o, i) => (
                <li key={o.value} data-roving-index={i}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    onMouseEnter={() => roving.setActive(i)}
                    onClick={() => commit(o)}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors lg:min-h-0',
                      i === roving.active ? 'bg-ink-900/[0.06] text-ink-900' : 'text-ink',
                      o.value === value && 'font-semibold',
                    )}
                  >
                    {o.person && <Avatar person={o.person} size="xs" />}
                    <span className="min-w-0 truncate">{o.label}</span>
                  </button>
                </li>
              ))
            )}
          </motion.ul>
        )}
      </PopoverPanel>
    </div>
  )
}
