import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { Icon } from './Icon'
import { Avatar, type AvatarPerson } from './Avatar'
import { Button } from './Button'
import { Input } from './Field'
import { Dialog } from './Dialog'
import { PopoverPanel } from './popover/PopoverPanel'
import { useRovingIndex } from './popover/useRovingIndex'
import { useCustomOptions } from '@/lib/custom-options'
import { cn } from '@/lib/utils'

export interface MultiSelectGroup {
  /** null renders with no header — the default/ungrouped section. Custom
   *  options added via "+" are appended here. */
  label: string | null
  options: string[]
}

interface Props {
  value: string[]
  onChange: (value: string[]) => void
  groups: MultiSelectGroup[]
  /** localStorage namespace for options a user adds via "+" — same convention as AddableSelect. */
  storageKey: string
  placeholder?: string
  className?: string
  /** Renders a text input at the top of the popover panel that filters the
   *  visible checkbox rows by label substring match (mirrors the filter
   *  pattern in `DepartmentCombobox`/`PeopleDirectory`). Purely a display
   *  filter — never touches `value`/`onChange`. Default false preserves
   *  existing behavior for call sites that don't pass it. */
  searchable?: boolean
  searchPlaceholder?: string
  /** Hides the "+ Add option" footer when false. Default true preserves
   *  existing behavior. */
  allowCustomAdd?: boolean
  /** When provided, renders a small avatar before each chip and option row,
   *  resolved per-option-label. Omitted call sites render no avatar. */
  avatarFor?: (label: string) => AvatarPerson
}

interface FlatRow {
  kind: 'header' | 'option'
  label: string
}

/** Popover-based multiselect: a closed trigger showing selected values as
 *  removable chips, an open panel of checkboxes grouped by an optional
 *  category header, and a "+" entry to add a custom option (persisted via
 *  the same `useCustomOptions` mechanism `AddableSelect` uses) — appended to
 *  the ungrouped/default section (the group with `label: null`). Built on
 *  the same `PopoverPanel`/roving-index infrastructure `Combobox` uses, for
 *  visual and interaction consistency. */
export function MultiSelectDropdown({
  value, onChange, groups, storageKey, placeholder = 'Select…', className,
  searchable = false, searchPlaceholder = 'Search…', allowCustomAdd = true, avatarFor,
}: Props) {
  const [custom, addOption] = useCustomOptions(storageKey)
  const [open, setOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Closing the panel clears any in-progress filter so reopening starts
  // fresh — mirrors `openAddOption` resetting `draft` on each open.
  useEffect(() => { if (!open) setSearch('') }, [open])

  const mergedGroups = useMemo(() => {
    const known = new Set(groups.flatMap((g) => g.options.map((o) => o.toLowerCase())))
    const extra = custom.filter((c) => !known.has(c.toLowerCase()))
    if (extra.length === 0) return groups
    const defaultIndex = groups.findIndex((g) => g.label === null)
    if (defaultIndex === -1) return [...groups, { label: null, options: extra }]
    return groups.map((g, i) => (i === defaultIndex ? { ...g, options: [...g.options, ...extra] } : g))
  }, [groups, custom])

  // Display-only filter over the merged groups — never touches `value`/
  // `onChange`. Same lowercase/trim/substring predicate as
  // `DepartmentCombobox`/`PeopleDirectory`. A header is dropped along with
  // its group once none of its options match.
  const visibleGroups = useMemo(() => {
    if (!searchable) return mergedGroups
    const q = search.trim().toLowerCase()
    if (!q) return mergedGroups
    return mergedGroups
      .map((g) => ({ ...g, options: g.options.filter((o) => o.toLowerCase().includes(q)) }))
      .filter((g) => g.options.length > 0)
  }, [mergedGroups, searchable, search])

  const flatRows = useMemo(() => {
    const out: FlatRow[] = []
    for (const g of visibleGroups) {
      if (g.label) out.push({ kind: 'header', label: g.label })
      for (const o of g.options) out.push({ kind: 'option', label: o })
    }
    return out
  }, [visibleGroups])
  const optionRows = useMemo(() => flatRows.filter((r) => r.kind === 'option'), [flatRows])

  function toggle(opt: string) {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt])
  }
  function remove(opt: string) {
    onChange(value.filter((v) => v !== opt))
  }

  const roving = useRovingIndex({
    count: optionRows.length,
    resetKey: open,
    onCommit: (i) => { const row = optionRows[i]; if (row) toggle(row.label) },
    containerRef: listRef,
  })

  function onTriggerKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); return }
    if (open) roving.onKeyDown(e)
  }

  function openAddOption() {
    setDraft('')
    setAddOpen(true)
  }
  function saveOption() {
    const trimmed = draft.trim()
    if (!trimmed) return
    const added = addOption(trimmed)
    if (!value.includes(added)) onChange([...value, added])
    setAddOpen(false)
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 pr-8 text-[13px] transition-colors focus-visible:focus-ring"
      >
        {value.length === 0 ? (
          <span className="px-1 py-0.5 text-muted/70">{placeholder}</span>
        ) : (
          value.map((v) => (
            <span key={v} className="flex items-center gap-1 rounded-md bg-panel px-1.5 py-0.5 text-[12px] text-ink-800">
              {avatarFor && <Avatar person={avatarFor(v)} size="xs" className="h-4 w-4 text-[9px]" />}
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={(e) => { e.stopPropagation(); remove(v) }}
                className="text-muted hover:text-ink-900"
              >
                <Icon name="X" size={11} />
              </button>
            </span>
          ))
        )}
        <Icon name="ChevronDown" size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
      </div>

      <PopoverPanel open={open} anchorRef={rootRef} onClose={() => setOpen(false)} matchAnchorWidth maxPanelHeight={280}>
        {({ maxHeight }) => (
          <motion.div
            ref={listRef}
            data-canvas-ui
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            style={{ maxHeight }}
            className="w-full overflow-y-auto scrollbar-thin rounded-xl border border-line bg-paper p-1 shadow-pop"
          >
            {searchable && (
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => roving.onKeyDown(e)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                autoFocus
                className="mb-1 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] outline-none focus-visible:focus-ring"
              />
            )}
            {flatRows.map((row) => {
              if (row.kind === 'header') {
                return (
                  <p key={`h-${row.label}`} className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted first:pt-1">
                    {row.label}
                  </p>
                )
              }
              const optionIndex = optionRows.indexOf(row)
              const checked = value.includes(row.label)
              return (
                <label
                  key={row.label}
                  data-roving-index={optionIndex}
                  onMouseEnter={() => roving.setActive(optionIndex)}
                  className={cn(
                    'flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px]',
                    optionIndex === roving.active ? 'bg-ink-900/[0.06] text-ink-900' : 'text-ink',
                  )}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggle(row.label)} className="accent-ink-900" />
                  {avatarFor && <Avatar person={avatarFor(row.label)} size="xs" />}
                  {row.label}
                </label>
              )
            })}
            {allowCustomAdd && (
              <button
                type="button"
                onClick={openAddOption}
                className="mt-1 flex min-h-9 w-full items-center gap-2 rounded-lg border-t border-line px-2.5 py-1.5 text-left text-[13px] font-medium text-teal-600 hover:bg-teal-100/40"
              >
                <Icon name="Plus" size={14} /> Add option
              </button>
            )}
          </motion.div>
        )}
      </PopoverPanel>

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add option"
        footer={
          <>
            <Button onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={saveOption} disabled={!draft.trim()}>Save</Button>
          </>
        }
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. New option"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveOption() } }}
        />
      </Dialog>
    </div>
  )
}
