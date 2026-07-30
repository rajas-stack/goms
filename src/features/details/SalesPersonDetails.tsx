import { motion } from 'framer-motion'
import { useDepartments, useOwnedBy, useSalesPerson, useSalesPersons, useSalesPostings } from '@/lib/api'
import { useWorkspace } from '@/features/workspace/context'
import { Icon } from '@/components/ui/Icon'
import { tierLabel } from '@/data/sales-tiers'
import { displayEndDate } from '@/lib/intervals'
import { isoToday } from '@/lib/dates'
import { cn, initials } from '@/lib/utils'

function Row({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Icon name={icon} size={14} className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
        <div className="break-words text-sm text-ink-900">{value}</div>
      </div>
    </div>
  )
}

/** Quick-peek for a salesperson, shown in the shared details panel. The full
 *  six-tab profile is a dedicated route (spec §5.4) — a six-tab profile does
 *  not fit a 380px aside — and arrives with the rest of Phase 1. */
export function SalesPersonDetails({ salesPersonId }: { salesPersonId: string }) {
  const ws = useWorkspace()
  const { data: person } = useSalesPerson(salesPersonId)
  const { data: postings = [] } = useSalesPostings(salesPersonId)
  const { data: people = [] } = useSalesPersons()
  const { data: owned = [] } = useOwnedBy(salesPersonId, isoToday())
  const { data: departments = [] } = useDepartments()

  if (!person) {
    return <p className="p-4 text-sm text-muted">This salesperson no longer exists.</p>
  }

  const current = postings.find((p) => p.endDate === null)
  const manager = current?.managerId ? people.find((p) => p.id === current.managerId) : undefined
  const deptById = new Map(departments.map((d) => [d.id, d]))
  // Book of Business: only orgNode entities have a lookup wired up in this
  // slice — contact/opportunity ownership renders with its raw id rather
  // than silently vanishing, so a row is never lost, just less pretty.
  const bookRows = owned.map((a) => ({
    assignment: a,
    label: a.entityType === 'orgNode' ? deptById.get(a.entityId)?.name ?? a.entityId : `${a.entityType}:${a.entityId}`,
  }))

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center gap-3 border-b border-line px-4 py-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel text-sm font-semibold text-ink-700">
          {initials(person.name)}
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-ink-900">{person.name}</h2>
          <p className="truncate text-[13px] text-muted">{current?.designation || 'No current posting'}</p>
        </div>
      </div>

      <div className="px-4 py-3">
        <h3 className="mb-1 text-[13px] font-semibold text-ink-900">Details</h3>
        <dl>
          <Row label="Official email" value={person.officialEmail} icon="Mail" />
          {person.mobile && <Row label="Mobile" value={person.mobile} icon="Phone" />}
          {current && <Row label="Tier" value={tierLabel(current.tierKey)} icon="Layers" />}
          {manager && <Row label="Reports to" value={manager.name} icon="Network" />}
          <Row label="Status" value={person.status} icon="CircleDot" />
        </dl>
      </div>

      <div className="border-t border-line px-4 py-3">
        <h3 className="mb-1 text-[13px] font-semibold text-ink-900">
          {postings.length > 1 ? `Postings · ${postings.length}` : 'Posting'}
        </h3>
        {postings.length === 0 ? (
          <p className="text-sm text-muted">No postings recorded.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {postings.map((p) => {
              // Storage is exclusive-end; humans read the last day actually held.
              const end = displayEndDate(p.endDate)
              return (
                <li key={p.id} className="rounded-lg border border-line px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-ink-900">{p.designation}</span>
                    <span className="shrink-0 rounded-full bg-panel px-2 py-0.5 text-[11px] text-ink-700">
                      {tierLabel(p.tierKey)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {p.startDate || 'Start unknown'} — {end ?? 'current'}
                    {p.changeType !== 'initial' && ` · ${p.changeType}`}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-line px-4 py-3">
        <h3 className="mb-1 text-[13px] font-semibold text-ink-900">
          {bookRows.length > 0 ? `Book of Business · ${bookRows.length}` : 'Book of Business'}
        </h3>
        {bookRows.length === 0 ? (
          <p className="text-sm text-muted">Nothing directly assigned as of today.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {bookRows.map(({ assignment, label }) => (
              <li key={assignment.id}>
                <button
                  onClick={() => assignment.entityType === 'orgNode' && ws.select('node', assignment.entityId)}
                  disabled={assignment.entityType !== 'orgNode'}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-2 text-left',
                    assignment.entityType === 'orgNode' && 'hover:bg-panel',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-900">{label}</span>
                  {assignment.role !== 'owner' && (
                    <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] text-sky-800">delegate</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </motion.div>
  )
}
