import { useMemo, useState } from 'react'
import { useOrgPeople } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ORG_DEPARTMENTS, descendantsOf } from '@/data/org-structure'
import { PeopleOrgChart } from '@/features/teams/DeliveryOrgChart'

/** The whole company as one chart (L0 at the top), optionally narrowed to a
 *  department — which keeps everyone in it plus the chain above them, so the
 *  department still hangs from the right leaders. */
export function OrgStructureChart() {
  const { data: people = [], isLoading } = useOrgPeople()
  const [department, setDepartment] = useState('all')

  const shown = useMemo(() => {
    const active = people.filter((p) => p.status === 'active')
    if (department === 'all') return active
    const byId = new Map(active.map((p) => [p.id, p]))
    const keep = new Set<string>()
    for (const p of active.filter((x) => x.departments.includes(department))) {
      for (let cursor: typeof p | undefined = p; cursor && !keep.has(cursor.id); cursor = cursor.managerId ? byId.get(cursor.managerId) : undefined) {
        keep.add(cursor.id)
      }
    }
    return active.filter((p) => keep.has(p.id))
  }, [people, department])

  const departments = [...new Set([...ORG_DEPARTMENTS, ...people.flatMap((p) => p.departments)])]
  const headcount = (d: string) => people.filter((p) => p.status === 'active' && p.departments.includes(d)).length
  const top = people.find((p) => p.managerId === null && p.level === 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-3 py-1.5">
        {['all', ...departments].map((d) => (
          <button
            key={d} onClick={() => setDepartment(d)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors',
              department === d ? 'border-ink-900/20 bg-ink-900/[0.06] text-ink-900' : 'border-line bg-white text-ink-600 hover:bg-panel',
            )}
          >
            {d === 'all' ? `Whole company · ${people.filter((p) => p.status === 'active').length}` : `${d} · ${headcount(d)}`}
          </button>
        ))}
        {top && <span className="ml-auto text-[12px] text-muted">{descendantsOf(top.id, people).size - 1} people under {top.name}</span>}
      </div>
      <div className="min-h-0 flex-1">
        <PeopleOrgChart people={shown} isLoading={isLoading} emptyMessage="No one in the org yet — add people from the Employees tab." />
      </div>
    </div>
  )
}
