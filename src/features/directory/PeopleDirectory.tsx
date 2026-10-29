import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useWorkspace } from '@/features/workspace/context'
import { useEmployeeDepartments } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { IconButton } from '@/components/ui/IconButton'
import { Select } from '@/components/ui/Field'
import { Combobox } from '@/components/ui/Combobox'
import { DuplicatesPanel } from '@/features/employees/DuplicatesPanel'
import { Avatar } from '@/components/ui/Avatar'
import { ContactHoverCard } from './ContactHoverCard'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import type { Employee, RelationshipStatus } from '@/lib/types'
import { useProfileImagesIndex } from '@/features/dms/ProfileImagesContext'
import type { ProfileImageRef } from '@/lib/useProfileImage'
import { fromAccountMappingPerson, matchesType, type CategoryOption, type ContactType, type DirectoryEntry } from './directoryEntries'

type DirectoryEmployee = Employee & { profileImage?: ProfileImageRef }
/** One list row: an Account Mapping person keeps their full record for the Account Mapping filters below. */
type Row = DirectoryEntry & { employee?: DirectoryEmployee }

/** Directory page: the Contact Type / Category dropdowns beside the search. The page owns the values (URL state). */
export interface TypeFilter {
  type: ContactType | ''
  category: string
  internalOptions: CategoryOption[]
  externalOptions: CategoryOption[]
  onChange: (type: ContactType | '', category: string) => void
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

const RELATIONSHIP_STATUS_OPTIONS: { value: RelationshipStatus; label: string }[] = [
  { value: 'engaged', label: 'Engaged' },
  { value: 'developing', label: 'Developing' },
  { value: 'dormant', label: 'Dormant' },
  { value: 'new', label: 'New' },
]

type SortKey = 'name' | 'designation' | 'organisation' | 'type' | 'category' | 'id'
type SortDir = 'asc' | 'desc'
interface SortRule { key: SortKey; dir: SortDir }

const byText = (a: string, b: string) => (!a ? (b ? 1 : 0) : !b ? -1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
const TEXT_DIRS: Record<SortDir, string> = { asc: 'A–Z', desc: 'Z–A' }
/** Multi-select sort: rules apply in the order they were picked. Each chip cycles ascending → descending → off. */
const SORT_OPTIONS: { key: SortKey; label: string; dirs: Record<SortDir, string>; compare: (a: Row, b: Row) => number }[] = [
  { key: 'name', label: 'Name', dirs: TEXT_DIRS, compare: (a, b) => byText(a.name, b.name) },
  { key: 'designation', label: 'Designation', dirs: TEXT_DIRS, compare: (a, b) => byText(a.designation, b.designation) },
  { key: 'organisation', label: 'Organisation', dirs: TEXT_DIRS, compare: (a, b) => byText(a.organisation, b.organisation) },
  { key: 'type', label: 'Contact type', dirs: { asc: 'Internal first', desc: 'External first' }, compare: (a, b) => Number(a.contactType === 'external') - Number(b.contactType === 'external') },
  { key: 'category', label: 'Category', dirs: TEXT_DIRS, compare: (a, b) => byText(a.groups[0] ?? '', b.groups[0] ?? '') },
  { key: 'id', label: 'Directory ID', dirs: { asc: 'Ascending', desc: 'Descending' }, compare: (a, b) => byText(a.displayId ?? '', b.displayId ?? '') },
]
/** Blanks stay last in both directions, so only the non-blank comparison flips. */
const directed = (compare: (a: Row, b: Row) => number, key: SortKey, dir: SortDir) => (a: Row, b: Row) => {
  const blank = (r: Row) => (key === 'id' ? !r.displayId : key === 'designation' ? !r.designation : key === 'organisation' ? !r.organisation : key === 'category' ? !r.groups[0] : false)
  if (blank(a) !== blank(b)) return blank(a) ? 1 : -1
  return dir === 'asc' ? compare(a, b) : compare(b, a)
}

// Fallback estimates for the virtualizer — `measureElement` re-measures each
// row/header's real rendered height after first paint and self-corrects, so
// these only need to be reasonable starting guesses.
const HEADER_ESTIMATE = 30
const ROW_ESTIMATE = 58

function letterOf(name: string): string {
  const c = name.trim()[0]?.toUpperCase() ?? ''
  return /[A-Z]/.test(c) ? c : '#'
}

/** A-Z jump-to-letter needs a stable anchor per letter even though the list
 *  itself is virtualized — rather than DOM-id anchors (which only exist for
 *  currently-rendered rows), the letter headers are flattened into the same
 *  virtualized sequence as the rows, so `scrollToIndex` on a header's index
 *  works exactly like the old `scrollIntoView` did, without ever needing
 *  every row mounted at once. */
type FlatRow =
  | { kind: 'header'; letter: string }
  | { kind: 'person'; row: Row }

/** Phonebook-style list with advanced search + filters: a free-text search
 *  (name, designation, contact number, email, reporting manager) plus
 *  dropdown filters for the categorical fields, and a Clear Filters reset.
 *  Selection is wired to the shared workspace context so it drives the
 *  details panel in place — the same reusable pattern the canvas uses. */
export function PeopleDirectory({ employees: allEmployees, others, typeFilter, renderActions }: {
  employees: Employee[]
  /** Directory page: Amnex employees and address-book contacts, listed beside the Account Mapping people. */
  others?: DirectoryEntry[]
  typeFilter?: TypeFilter
  /** Directory page: the icon actions shown on every row. */
  renderActions?: (entry: DirectoryEntry, selected: boolean) => ReactNode
}) {
  const profiles = useProfileImagesIndex()
  const ws = useWorkspace()
  const isNarrow = useMediaQuery('(max-width: 639.98px)')
  const { data: deptById = {} } = useEmployeeDepartments()
  // Vacant positions are seats, not people — the phonebook only lists actual employees.
  const employees: DirectoryEmployee[] = useMemo(() => allEmployees.filter((e) => !e.vacant).map(e => {
    if (!profiles?.configured) return e
    const ref = profiles.people?.[e.id] ?? e.id
    const version = profiles.versions[ref]
    return { ...e, photoUrl: null, profileImage: version ? { userId: ref, version } : undefined }
  }), [allEmployees, profiles])
  const rows: Row[] = useMemo(
    () => [...employees.map((e) => ({ ...fromAccountMappingPerson(e, deptById[e.id]?.name), employee: e })), ...(others ?? [])],
    [employees, others, deptById],
  )
  const [query, setQuery] = useState('')
  const [designation, setDesignation] = useState('')
  const [managerId, setManagerId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [relationshipStatus, setRelationshipStatus] = useState('')
  const [duplicatesOpen, setDuplicatesOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [sortKeys, setSortKeys] = useState<SortRule[]>([])
  // Hover preview: mouse/trackpad only, after a short pause so sweeping across rows doesn't flicker cards.
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)')
  const [hover, setHover] = useState<{ row: Row; rect: DOMRect } | null>(null)
  const hoverTimer = useRef<number | undefined>(undefined)
  const hoverRow = (row: Row, el: HTMLElement | null) => {
    window.clearTimeout(hoverTimer.current)
    if (!el) { setHover(null); return }
    hoverTimer.current = window.setTimeout(() => setHover({ row, rect: el.getBoundingClientRect() }), 120)
  }
  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])
  const toggleSort = (key: SortKey) => setSortKeys((rules) => {
    const current = rules.find((r) => r.key === key)
    if (!current) return [...rules, { key, dir: 'asc' }]
    return current.dir === 'asc' ? rules.map((r) => (r.key === key ? { key, dir: 'desc' } : r)) : rules.filter((r) => r.key !== key)
  })

  // Resolve manager names from the same in-scope list so we can both search
  // and filter by reporting manager without an extra fetch.
  const nameById = useMemo(
    () => new Map(employees.map((e) => [e.id, e.name] as const)),
    [employees],
  )

  const designations = useMemo(
    () => [...new Set(rows.map((e) => e.designation).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  // Distinct departments among the in-scope people (resolved via the tree map).
  const departments = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of employees) {
      const d = deptById[e.id]
      if (d) map.set(d.id, d.name)
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [employees, deptById])

  const managers = useMemo(() => {
    const photoById = new Map(employees.map((e) => [e.id, { photoUrl: e.photoUrl, profileImage: e.profileImage }] as const))
    const ids = new Set(employees.map((e) => e.managerId).filter((id): id is string => !!id))
    return [...ids]
      .map((id) => ({ id, name: nameById.get(id) ?? 'Unknown', ...photoById.get(id) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [employees, nameById])

  // Combobox option shapes ({ value, label }) for the three typeahead filters.
  const departmentOptions = useMemo(
    () => departments.map((d) => ({ value: d.id, label: d.name })),
    [departments],
  )
  const designationOptions = useMemo(
    () => designations.map((d) => ({ value: d, label: d })),
    [designations],
  )
  const managerOptions = useMemo(
    () => managers.map((m) => ({ value: m.id, label: m.name, person: m })),
    [managers],
  )

  const hasTypeFilter = !!typeFilter && (typeFilter.type !== '' || typeFilter.category !== '')
  const hasFilters = query.trim() !== '' || designation !== '' || managerId !== '' || departmentId !== '' || relationshipStatus !== '' || hasTypeFilter
  // Only the dropdowns — the free-text query has its own always-visible
  // field, so counting it on the Filter button would be misleading.
  const activeFilterCount = [departmentId, designation, managerId, relationshipStatus].filter(Boolean).length
  function clearFilters() {
    setQuery('')
    setDesignation('')
    setManagerId('')
    setDepartmentId('')
    setRelationshipStatus('')
    if (hasTypeFilter) typeFilter.onChange('', '')
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      const e = r.employee
      if (typeFilter && !matchesType(r, typeFilter.type, typeFilter.category)) return false
      if (departmentId && (!e || deptById[e.id]?.id !== departmentId)) return false
      if (designation && r.designation !== designation) return false
      if (managerId && e?.managerId !== managerId) return false
      if (relationshipStatus && e?.relationshipStatus !== relationshipStatus) return false
      if (q) {
        const managerName = e?.managerId ? nameById.get(e.managerId) ?? '' : ''
        const haystack = [r.name, r.designation, r.phone, r.email, r.displayId ?? '', managerName, e ? '' : `${r.organisation} ${r.groups.join(' ')}`].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [rows, typeFilter, query, designation, managerId, departmentId, relationshipStatus, deptById, nameById])

  const sorted = useMemo(() => {
    if (!sortKeys.length) return filtered
    const compares = sortKeys.map(({ key, dir }) => directed(SORT_OPTIONS.find((o) => o.key === key)!.compare, key, dir))
    return [...filtered].sort((a, b) => compares.reduce((result, compare) => result || compare(a, b), 0))
  }, [filtered, sortKeys])

  const groups = useMemo(() => {
    const byLetter = new Map<string, Row[]>()
    for (const e of filtered) {
      const letter = letterOf(e.name)
      if (!byLetter.has(letter)) byLetter.set(letter, [])
      byLetter.get(letter)!.push(e)
    }
    return new Map([...byLetter.entries()].sort(([a], [b]) => a.localeCompare(b)))
  }, [filtered])

  const availableLetters = new Set(groups.keys())

  // Flatten letter groups + people into one sequence so headers and rows
  // share a single virtualized list (see `FlatRow` above).
  // A custom sort replaces the A-Z letter sections with one flat list in the chosen order.
  const flatRows = useMemo(() => {
    if (sortKeys.length) return sorted.map((row): FlatRow => ({ kind: 'person', row }))
    const out: FlatRow[] = []
    for (const [letter, people] of groups) {
      out.push({ kind: 'header', letter })
      for (const p of people) out.push({ kind: 'person', row: p })
    }
    return out
  }, [groups, sorted, sortKeys.length])

  const letterToIndex = useMemo(() => {
    const map = new Map<string, number>()
    flatRows.forEach((row, i) => { if (row.kind === 'header') map.set(row.letter, i) })
    return map
  }, [flatRows])

  const scrollRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (flatRows[i]?.kind === 'header' ? HEADER_ESTIMATE : ROW_ESTIMATE),
    overscan: 12,
  })

  function jumpTo(letter: string) {
    const idx = letterToIndex.get(letter)
    if (idx != null) rowVirtualizer.scrollToIndex(idx, { align: 'start' })
  }

  const isSelected = (r: Row) => ws.selection?.kind === r.kind && ws.selection.id === r.id

  const searchField = (
    <label className="flex h-11 w-full items-center gap-2 rounded-lg border border-line bg-white px-3 sm:h-10 sm:w-[40ch] sm:shrink-0">
      <Icon name="Search" size={15} className="shrink-0 text-muted" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        // Short enough for the 40-character field without clipping mid-word.
        placeholder={isNarrow ? 'Search people…' : 'Search name, ID, phone, email, manager…'}
        className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/70"
      />
      {query && (
        <button
          onClick={() => setQuery('')}
          aria-label="Clear search text"
          className="rounded p-0.5 text-muted hover:text-ink-900"
        >
          <Icon name="X" size={14} />
        </button>
      )}
    </label>
  )

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-2 border-b border-line px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {searchField}
            {typeFilter && <TypeFilterSelects filter={typeFilter} />}
            <div className="flex items-center gap-0.5">
              <span className="relative">
                <IconButton icon="SlidersHorizontal" label={filtersOpen ? 'Hide filters' : 'Show filters'} aria-pressed={filtersOpen} onClick={() => setFiltersOpen((v) => !v)} />
                {activeFilterCount > 0 && <span className="pointer-events-none absolute -right-0.5 -top-0.5 rounded-full bg-ink-900 px-1 text-[9px] font-semibold leading-[14px] text-paper">{activeFilterCount}</span>}
              </span>
              <IconButton icon="Copy" label="Find duplicates" onClick={() => setDuplicatesOpen(true)} />
              <span className="relative">
                <IconButton icon="ArrowDownUp" label={sortOpen ? 'Hide sorting' : 'Sort'} aria-pressed={sortOpen} onClick={() => setSortOpen((v) => !v)} />
                {sortKeys.length > 0 && <span className="pointer-events-none absolute -right-0.5 -top-0.5 rounded-full bg-ink-900 px-1 text-[9px] font-semibold leading-[14px] text-paper">{sortKeys.length}</span>}
              </span>
            </div>
            <p className="ml-auto text-[12px] text-muted">
              {hasFilters ? `${filtered.length} of ${rows.length} people` : `${rows.length} people`}
            </p>
          </div>

          {filtersOpen && (
            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <Combobox
                value={departmentId}
                onChange={setDepartmentId}
                options={departmentOptions}
                placeholder="All departments"
                aria-label="Filter by department"
                className="w-full sm:min-w-[9rem] sm:flex-1"
              />
              <Combobox
                value={designation}
                onChange={setDesignation}
                options={designationOptions}
                placeholder="All designations"
                aria-label="Filter by designation"
                className="w-full sm:min-w-[9rem] sm:flex-1"
              />
              <Combobox
                value={managerId}
                onChange={setManagerId}
                options={managerOptions}
                placeholder="All reporting managers"
                aria-label="Filter by reporting manager"
                className="w-full sm:min-w-[9rem] sm:flex-1"
              />
              <Combobox
                value={relationshipStatus}
                onChange={setRelationshipStatus}
                options={RELATIONSHIP_STATUS_OPTIONS}
                placeholder="All relationship statuses"
                aria-label="Filter by relationship status"
                className="w-full sm:min-w-[9rem] sm:flex-1"
              />
              <IconButton icon="FilterX" label="Clear filters" onClick={clearFilters} disabled={!hasFilters} />
            </div>
          )}

          {sortOpen && (
            <div role="group" aria-label="Sort by" className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-muted">Sort by</span>
              {SORT_OPTIONS.map(({ key, label, dirs }) => {
                const order = sortKeys.findIndex((r) => r.key === key)
                const rule = sortKeys[order]
                return (
                  <button
                    key={key} type="button" aria-pressed={order >= 0} onClick={() => toggleSort(key)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[12px] transition-colors focus-visible:focus-ring',
                      order >= 0 ? 'border-ink-900 bg-ink-900 text-paper' : 'border-line text-ink-700 hover:bg-ink-900/[0.05]',
                    )}
                  >
                    {rule && <span className="mr-1 font-mono tabular-nums">{order + 1}</span>}{label}
                    {rule && <span className="ml-1 opacity-75">{dirs[rule.dir]}</span>}
                  </button>
                )
              })}
            </div>
          )}

          <DuplicatesPanel open={duplicatesOpen} onClose={() => setDuplicatesOpen(false)} />
        </div>
        {hover && <ContactHoverCard entry={hover.row} person={hover.row.employee ?? hover.row} anchor={hover.rect} />}

        <div ref={scrollRef} onScroll={() => { window.clearTimeout(hoverTimer.current); setHover(null) }} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
          {groups.size === 0 && (
            <p className="px-1 py-8 text-center text-sm text-muted">No people match your filters.</p>
          )}
          {groups.size > 0 && (
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const row = flatRows[vi.index]
                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={rowVirtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }}
                    className={row.kind === 'person' ? 'pb-1' : undefined}
                  >
                    {row.kind === 'header' ? (
                      // `first:` can't reach here — virtualization wraps every
                      // row in its own sibling container, so each header is
                      // always its wrapper's only child. Use the flat index
                      // instead to skip the top gap on the very first header.
                      <h3 className={cn('mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted', vi.index === 0 ? 'pt-0' : 'pt-4')}>
                        {row.letter}
                      </h3>
                    ) : (
                      <PersonRow
                        row={row.row}
                        selected={isSelected(row.row)}
                        // Clicking the open contact again closes its profile.
                        onSelect={() => (isSelected(row.row) ? ws.clearSelection() : ws.select(row.row.kind, row.row.id))}
                        actions={renderActions}
                        onHover={canHover ? (el) => hoverRow(row.row, el) : undefined}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {!sortKeys.length && <nav className="flex w-6 shrink-0 flex-col items-center justify-center gap-px overflow-y-auto border-l border-line py-2">
        {ALPHABET.map((letter) => (
          <button
            key={letter}
            onClick={() => jumpTo(letter)}
            disabled={!availableLetters.has(letter)}
            className={cn(
              'w-full rounded text-center font-mono text-[9px] leading-[14px]',
              availableLetters.has(letter) ? 'text-muted hover:bg-ink-900/[0.06] hover:text-ink-900' : 'text-line',
            )}
          >
            {letter}
          </button>
        ))}
      </nav>}
    </div>
  )
}

/** Extracted unchanged from the old inline row markup (same classes, same
 *  behavior) — just given its own component so the virtualized list above
 *  can render it per flattened row without inlining the JSX there. With
 *  `actions` (Directory page) the row's icon actions sit over its right end. */
function PersonRow({ row: e, selected, onSelect, actions, onHover }: {
  row: Row
  selected: boolean
  onSelect: () => void
  actions?: (entry: DirectoryEntry, selected: boolean) => ReactNode
  /** The row element on mouse enter, null on leave. */
  onHover?: (el: HTMLElement | null) => void
}) {
  const hoverProps = onHover ? { onMouseEnter: (ev: React.MouseEvent<HTMLElement>) => onHover(ev.currentTarget), onMouseLeave: () => onHover(null) } : {}
  const button = (
    <button
      {...(actions ? {} : hoverProps)}
      onClick={onSelect}
      data-testid={`person-row-${e.kind === 'employee' ? e.id : `${e.kind}-${e.id}`}`}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
        selected ? 'bg-ink-900 text-paper' : 'hover:bg-ink-900/[0.05]',
        actions && 'pr-28',
      )}
    >
      <Avatar person={e.employee ?? e} size="sm" />
      <span className="min-w-0 flex-1">
        <span className={cn('block break-words text-[13px] font-medium', selected ? 'text-paper' : 'text-ink-900')}>{e.name}</span>
        <span className={cn('block break-words text-[11px]', selected ? 'text-paper/70' : 'text-muted')}>
          {e.designation || e.organisation}
          {e.displayId && <span className="ml-1.5 font-mono tabular-nums">· {e.displayId}</span>}
        </span>
      </span>
    </button>
  )
  if (!actions) return button
  return (
    <div className="relative" {...hoverProps}>
      {button}
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">{actions(e, selected)}</div>
    </div>
  )
}

/** Contact Type, then a Category of that type. Changing the type clears a category that does not belong to it. */
function TypeFilterSelects({ filter }: { filter: TypeFilter }) {
  const options = filter.type === 'internal' ? filter.internalOptions : filter.type === 'external' ? filter.externalOptions : []
  return (
    <>
      <Select
        aria-label="Contact type" value={filter.type} className="h-11 w-auto sm:h-10"
        onChange={(event) => filter.onChange(event.target.value as ContactType | '', '')}
      >
        <option value="">All contacts</option>
        <option value="internal">Internal</option>
        <option value="external">External</option>
      </Select>
      <Select
        aria-label={filter.type === 'internal' ? 'Department' : 'Category'} value={filter.category} disabled={!filter.type}
        className="h-11 w-auto max-w-[12rem] sm:h-10" onChange={(event) => filter.onChange(filter.type, event.target.value)}
      >
        <option value="">{filter.type === 'internal' ? 'All departments' : 'All categories'}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </>
  )
}
