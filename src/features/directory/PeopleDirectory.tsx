import { useMemo, useState } from 'react'
import { useWorkspace } from '@/features/workspace/context'
import { useEmployeeDepartments } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { cn, initials } from '@/lib/utils'
import type { Employee } from '@/lib/types'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

function letterOf(name: string): string {
  const c = name.trim()[0]?.toUpperCase() ?? ''
  return /[A-Z]/.test(c) ? c : '#'
}

/** Phonebook-style list with advanced search + filters: a free-text search
 *  (name, designation, contact number, email, reporting manager) plus
 *  dropdown filters for the categorical fields, and a Clear Filters reset.
 *  Selection is wired to the shared workspace context so it drives the
 *  details panel in place — the same reusable pattern the canvas uses. */
export function PeopleDirectory({ employees: allEmployees }: { employees: Employee[] }) {
  const ws = useWorkspace()
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
        const deptName = deptById[e.id]?.name ?? ''
        const haystack = [e.name, e.designation, e.phone, e.email, managerName, deptName].join(' ').toLowerCase()
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

  function jumpTo(letter: string) {
    document.getElementById(`directory-letter-${letter}`)?.scrollIntoView({ block: 'start' })
  }

  const selectedEmp = ws.selection?.kind === 'employee'
    ? employees.find((e) => e.id === ws.selection!.id)
    : undefined

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-2.5 border-b border-line px-4 py-3">
          <label className="flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3">
            <Icon name="Search" size={15} className="text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, designation, phone, email, or manager…"
              className="h-full flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/70"
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

          <div className="flex flex-wrap items-center gap-2">
            <Combobox
              value={departmentId}
              onChange={setDepartmentId}
              options={departmentOptions}
              placeholder="All departments"
              aria-label="Filter by department"
              className="min-w-[9rem] flex-1"
            />

            <Combobox
              value={designation}
              onChange={setDesignation}
              options={designationOptions}
              placeholder="All designations"
              aria-label="Filter by designation"
              className="min-w-[9rem] flex-1"
            />

            <Combobox
              value={managerId}
              onChange={setManagerId}
              options={managerOptions}
              placeholder="All reporting managers"
              aria-label="Filter by reporting manager"
              className="min-w-[9rem] flex-1"
            />

            <Button
              size="sm"
              variant="ghost"
              onClick={clearFilters}
              disabled={!hasFilters}
              className="shrink-0"
            >
              <Icon name="X" size={14} /> Clear filters
            </Button>
          </div>

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
              <p className="truncate text-sm font-semibold text-ink-900">{selectedEmp.name}</p>
              <p className="truncate text-xs text-muted">{selectedEmp.designation}</p>
              {deptById[selectedEmp.id] && <p className="truncate text-xs text-muted">{deptById[selectedEmp.id].name}</p>}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
          {groups.size === 0 && (
            <p className="px-1 py-8 text-center text-sm text-muted">No people match your filters.</p>
          )}
          {[...groups.entries()].map(([letter, people]) => (
            <section key={letter} id={`directory-letter-${letter}`} className="mb-4 scroll-mt-2">
              <h3 className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">{letter}</h3>
              <div className="space-y-1">
                {people.map((e) => {
                  const selected = ws.selection?.kind === 'employee' && ws.selection.id === e.id
                  return (
                    <button
                      key={e.id}
                      onClick={() => ws.select('employee', e.id)}
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
                        <span className={cn('block truncate text-[13px] font-medium', selected ? 'text-paper' : 'text-ink-900')}>{e.name}</span>
                        <span className={cn('block truncate text-[11px]', selected ? 'text-paper/70' : 'text-muted')}>{e.designation}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
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
