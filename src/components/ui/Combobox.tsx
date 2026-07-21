import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from './Icon'
import { useClampToAncestor } from './useClampToAncestor'
import { cn } from '@/lib/utils'

export interface ComboboxOption {
  value: string
  label: string
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
}

/**
 * Typeahead select: an input that filters `options` as you type and commits a
 * value on pick. An empty value means nothing is selected (the placeholder
 * shows). Built on the same border/height tokens as Input/Select so it drops in
 * beside them. Closes on outside click / Escape; ↑/↓ move the active option and
 * Enter commits it.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const clampStyle = useClampToAncestor(open, listRef)

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? '',
    [options, value],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  // Closed: the input shows the committed selection. Open: it shows whatever the
  // user is typing (starting blank), while the current selection surfaces as the
  // placeholder so it never looks like the filter was cleared.
  const shown = open ? query : selectedLabel
  const placeholderText = open && selectedLabel ? selectedLabel : placeholder

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Reset the highlighted row whenever the visible match set changes.
  useEffect(() => setActive(0), [query, open])

  function commit(option: ComboboxOption) {
    onChange(option.value)
    setOpen(false)
    inputRef.current?.blur()
  }

  function clear() {
    onChange('')
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setActive((i) => Math.min(i + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = matches[active]
      if (opt) commit(opt)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div className="relative">
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
          className="h-9 w-full rounded-lg border border-line bg-white pl-3 pr-8 text-[13px] text-ink placeholder:text-muted/70 transition-colors focus:border-ink-600 focus-visible:focus-ring"
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

      <AnimatePresence>
        {open && (
          <motion.ul
            ref={listRef}
            role="listbox"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            style={clampStyle}
            className="absolute z-40 mt-1 max-h-60 w-full overflow-y-auto scrollbar-thin rounded-xl border border-line bg-paper p-1 shadow-pop"
          >
            {matches.length === 0 ? (
              <li className="px-2.5 py-2 text-[13px] text-muted">No matches</li>
            ) : (
              matches.map((o, i) => (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => commit(o)}
                    className={cn(
                      'flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors',
                      i === active ? 'bg-ink-900/[0.06] text-ink-900' : 'text-ink',
                      o.value === value && 'font-semibold',
                    )}
                  >
                    {o.label}
                  </button>
                </li>
              ))
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
