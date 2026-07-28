import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useWorkspace } from '@/features/workspace/context'
import { useEmployeeDepartments } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { MobileFilterBar } from '@/components/MobileFilterBar'
import { cn, initials } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import type { Employee } from '@/lib/types'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

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
  | { kind: 'person'; employee: Employee }

/** Phonebook-style list with advanced search + filters: a free-text search
 *  (name, designation, contact number, email, reporting manager) plus
 *  dropdown filters for the categorical fields, and a Clear Filters reset.
 *  Selection is wired to the shared workspace context so it drives the
 *  details panel in place — the same reusable pattern the canvas uses. */
export function PeopleDirectory({ employees: allEmployees }: { employees: Employee[] }) {
  const ws = useWorkspace()
  const isNarrow = useMediaQuery('(max-width: 639.98px)')
  const { data: deptById = {} } = useEmployeeDepartments()
  // Vacant positions are seats, not people — the phonebook only lists actual employees.
  const employees = useMemo(() => allEmployees.filter((e) => !e.vacant), [allEmployees])
  const [query, setQuery] = useState('')
  const [designation, setDesignation] = useState('')
  const [managerId, setManagerId] = useState('')
  const [departmentId, setDepartmentId] = useState('')

  // Resolve manager names from the same in-scope list so we can both search
  // and filter by reporting manager without an extra fetch.
  const nameById = useMemo(
    () => new Map(employees.map((e) => [e.id, e.name] as const)),
    [employees],
  )

  const designations = useMemo(
    () => [...new Set(employees.map((e) => e.designation).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [employees],
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
    const ids = new Set(employees.map((e) => e.managerId).filter((id): id is string => !!id))
    return [...ids]
      .map((id) => ({ id, name: nameById.get(id) ?? 'Unknown' }))
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
    () => managers.map((m) => ({ value: m.id, label: m.name })),
    [managers],
  )

  const hasFilters = query.trim() !== '' || designation !== '' || managerId !== '' || departmentId !== ''
  // Only the three dropdowns — the free-text query has its own always-visible
  // field, so counting it on the collapsed Filter button would be misleading.
  const activeFilterCount = [departmentId, designation, managerId].filter(Boolean).length
  function clearFilters() {
    setQuery('')
    setDesignation('')
    setManagerId('')
    setDepartmentId('')
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return employees.filter((e) => {
      if (departmentId && deptById[e.id]?.id !== departmentId) return false
      if (designation && e.designation !== designation) return false
      if (managerId && e.managerId !== managerId) return false
      if (q) {
        const managerName = e.managerId ? nameById.get(e.managerId) ?? '' : ''
        const haystack = [e.name, e.designation, e.phone, e.email, managerName].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [employees, query, designation, managerId, departmentId, deptById, nameById])

  const groups = useMemo(() => {
    const byLetter = new Map<string, Employee[]>()
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
  const flatRows = useMemo(() => {
    const out: FlatRow[] = []
    for (const [letter, people] of groups) {
      out.push({ kind: 'header', letter })
      for (const p of people) out.push({ kind: 'person', employee: p })
    }
    return out
  }, [groups])

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

  const selectedEmp = ws.selection?.kind === 'employee'
    ? employees.find((e) => e.id === ws.selection!.id)
    : undefined

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-2.5 border-b border-line px-4 py-3">
          <label className="flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-3 sm:h-10">
            <Icon name="Search" size={15} className="shrink-0 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // The full field list doesn't fit a phone's input — it was
              // clipped mid-word there, so narrow screens get the short form.
              placeholder={isNarrow ? 'Search people…' : 'Search by name, designation, phone, email, or manager…'}
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

          {/* Below `sm` the three dropdowns live behind a Filter button (free-text
              search stays visible — it's the primary action); from `sm` up they're
              inline as before. One per row on a phone once opened (`grid-cols-1`):
              wrapped inline, the third got squeezed to its 9rem minimum and its
              placeholder was clipped mid-word. */}
          <MobileFilterBar activeCount={activeFilterCount}>
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

            <Button
              size="sm"
              variant="ghost"
              onClick={clearFilters}
              disabled={!hasFilters}
              className="h-11 w-full justify-center sm:h-auto sm:w-auto sm:shrink-0"
            >
              <Icon name="X" size={14} /> Clear filters
            </Button>
          </div>
          </MobileFilterBar>

          <p className="text-[12px] text-muted">
            {hasFilters ? `${filtered.length} of ${employees.length} people` : `${employees.length} people`}
          </p>
        </div>

        {selectedEmp && !selectedEmp.vacant && (
          <div className="flex items-center gap-3 border-b border-line bg-panel/40 px-4 py-3">
            {selectedEmp.photoUrl ? (
              <img src={selectedEmp.photoUrl} alt={selectedEmp.name} className="h-14 w-14 shrink-0 rounded-xl object-cover" />
            ) : (
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-teal-100 font-display text-lg font-bold text-teal-600">
                {initials(selectedEmp.name)}
              </span>
            )}
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-ink-900">{selectedEmp.name}</p>
              <p className="break-words text-xs text-muted">{selectedEmp.designation}</p>
              {deptById[selectedEmp.id] && <p className="break-words text-xs text-muted">{deptById[selectedEmp.id].name}</p>}
            </div>
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
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
                        employee={row.employee}
                        selected={ws.selection?.kind === 'employee' && ws.selection.id === row.employee.id}
                        onSelect={() => ws.select('employee', row.employee.id)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <nav className="flex w-6 shrink-0 flex-col items-center justify-center gap-px overflow-y-auto border-l border-line py-2">
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
      </nav>
    </div>
  )
}

/** Extracted unchanged from the old inline row markup (same classes, same
 *  behavior) — just given its own component so the virtualized list above
 *  can render it per flattened row without inlining the JSX there. */
function PersonRow({ employee: e, selected, onSelect }: { employee: Employee; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
        selected ? 'bg-ink-900 text-paper' : 'hover:bg-ink-900/[0.05]',
      )}
    >
      {e.photoUrl ? (
        <img src={e.photoUrl} alt={e.name} className="h-8 w-8 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-[11px] font-semibold',
          selected ? 'bg-indigo text-paper' : 'bg-teal-100 text-teal-600',
        )}>
          {initials(e.name)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block break-words text-[13px] font-medium', selected ? 'text-paper' : 'text-ink-900')}>{e.name}</span>
        <span className={cn('block break-words text-[11px]', selected ? 'text-paper/70' : 'text-muted')}>{e.designation}</span>
      </span>
    </button>
  )
}
