import { Can } from '@/lib/permissions'
import { useMemo } from 'react'
import {
  useAllTimelineEvents, useCurrentPostings, useOpenFollowUps, useOpportunities,
  useOwnershipAssignments, useSalesPersons,
} from '@/lib/api'
import { isoToday } from '@/lib/dates'
import { computeSalesTeamInsights } from '@/features/sales/salesTeamInsights'
import { STATUS_LABEL } from '@/data/sales-status'
import { Bar, Empty, Panel, StatCard } from './InsightsPrimitives'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import type { AvatarPerson } from '@/components/ui/Avatar'

function ConfidenceTag() {
  return (
    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
      Partial
    </span>
  )
}

const STATUS_KEYS = Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]

export function SalesTeamInsights() {
  const { data: people = [], isLoading: peopleLoading } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()
  const { data: ownership = [] } = useOwnershipAssignments()
  const { data: opportunities = [] } = useOpportunities()
  const { data: openFollowUps = [] } = useOpenFollowUps()
  const { data: timelineEvents = [] } = useAllTimelineEvents()

  const data = useMemo(
    () => computeSalesTeamInsights({ people, postings, ownership, opportunities, openFollowUps, timelineEvents, asOf: isoToday() }),
    [people, postings, ownership, opportunities, openFollowUps, timelineEvents],
  )

  if (peopleLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">Loading sales team insights…</div>
  }
  if (people.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-panel text-muted">
          <Icon name="Users" size={18} />
        </div>
        <p className="text-sm text-muted">No sales team data yet — add people from the Sales Team tab first.</p>
      </div>
    )
  }

  // Rows only carry a sales person id + name; the face comes from the roster.
  const photoById = new Map(people.map((p) => [p.id, p.photoUrl] as const))
  const personOf = (id: string, name: string): AvatarPerson => ({ name, photoUrl: photoById.get(id) ?? null })

  const maxOf = (n: number[]) => Math.max(1, ...n)
  const maxTeamSize = maxOf(data.teamByManager.map((t) => t.directReportCount))
  const maxOwnership = maxOf(data.ownershipByPerson.map((o) => o.total))
  const maxFollowUps = maxOf(data.followUpsByAssignee.map((f) => f.count))
  const maxOpportunities = maxOf(data.opportunities.byPerson.map((o) => o.count))
  const maxActivity = maxOf(data.activity.byPerson.map((a) => a.count))

  return (
    <div className="flex h-full flex-col">
      <div className="z-10 border-b border-line bg-white/80 px-4 py-4 sm:px-6">
        <span className="eyebrow">Sales Team</span>
        <h1 className="font-display text-xl font-bold leading-tight text-ink-900">Sales Team Insights</h1>
        <p className="text-[12px] text-muted">Roster, reporting hierarchy, ownership, and pipeline — all from live GOMS data</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-4 py-4 sm:space-y-6 sm:px-6 sm:py-6">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <StatCard icon="Users" tone="emerald" label="Total sales-team members" value={data.totalMembers} />
          <StatCard icon="UserCheck" tone="indigo" label="Active" value={data.statusBreakdown.active} sub={`${data.totalMembers - data.statusBreakdown.active} other status`} />
          <StatCard icon="CalendarClock" tone="amber" label="Open follow-ups" value={openFollowUps.length} />
          <StatCard icon="Briefcase" tone="crimson" label="Unattributed opportunities" value={data.opportunities.unattributedCount} sub={data.opportunities.ambiguousCount > 0 ? `${data.opportunities.ambiguousCount} ambiguous` : undefined} />
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Status breakdown" icon="PieChart">
            <div className="space-y-2.5">
              {STATUS_KEYS.map((s) => (
                <Bar key={s} label={STATUS_LABEL[s]} value={data.statusBreakdown[s]} max={data.totalMembers} barClass="bg-indigo" />
              ))}
            </div>
          </Panel>

          <Panel title={`Team size by manager · ${data.teamByManager.length}`} icon="Network">
            {data.teamByManager.length === 0 ? (
              <Empty label="No manager relationships recorded yet." />
            ) : (
              <div className="space-y-2.5">
                {data.teamByManager.map((t) => (
                  <Bar key={t.managerId} label={t.managerName} person={personOf(t.managerId, t.managerName)} value={t.directReportCount} max={maxTeamSize} barClass="bg-teal" />
                ))}
              </div>
            )}
            {data.flaggedCount > 0 && (
              <p className="mt-3 text-[11px] text-amber-700">
                {data.flaggedCount} {data.flaggedCount === 1 ? 'person has' : 'people have'} a broken or circular manager reference — shown in the Org Chart as flagged roots, not counted under any manager here.
              </p>
            )}
          </Panel>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title={`Ownership distribution · ${data.ownershipByPerson.length}`} icon="Building2">
            {data.ownershipByPerson.length === 0 ? (
              <Empty label="No ownership assignments yet." />
            ) : (
              <div className="space-y-2.5">
                {data.ownershipByPerson.map((o) => (
                  <Bar key={o.salesPersonId} label={o.name} person={personOf(o.salesPersonId, o.name)} value={o.total} max={maxOwnership} barClass="bg-emerald" />
                ))}
              </div>
            )}
          </Panel>

          <Panel title={`Open follow-ups by assignee · ${openFollowUps.length}`} icon="CalendarClock">
            {data.followUpsByAssignee.length === 0 ? (
              <Empty label="No open follow-ups." />
            ) : (
              <div className="space-y-2.5">
                {data.followUpsByAssignee.map((f) => (
                  <Bar key={f.salesPersonId ?? 'unassigned'} label={f.name} person={f.salesPersonId ? personOf(f.salesPersonId, f.name) : undefined} value={f.count} max={maxFollowUps} barClass="bg-amber" />
                ))}
              </div>
            )}
          </Panel>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title={<span className="flex items-center gap-2">Opportunities by salesperson <ConfidenceTag /></span>} icon="Briefcase">
            <p className="mb-3 text-[11px] text-muted">
              Based on explicit ownership assignments only — {data.opportunities.unattributedCount} without one {data.opportunities.unattributedCount === 1 ? 'is' : 'are'} excluded, never guessed from the legacy contact-email field.
              {data.opportunities.ambiguousCount > 0 && ` ${data.opportunities.ambiguousCount} more ${data.opportunities.ambiguousCount === 1 ? 'has' : 'have'} more than one open owner recorded — also excluded as ambiguous, never resolved by picking one.`}
            </p>
            {data.opportunities.byPerson.length === 0 ? (
              <Empty label="No opportunities with a recorded owner yet." />
            ) : (
              <div className="space-y-2.5">
                {data.opportunities.byPerson.map((o) => (
                  <Bar key={o.salesPersonId} label={o.name} person={personOf(o.salesPersonId, o.name)} value={o.count} max={maxOpportunities} barClass="bg-indigo" />
                ))}
              </div>
            )}
          </Panel>

          <Can module="an.financial" action="read">
          <Panel title={<span className="flex items-center gap-2">Pipeline value by salesperson <ConfidenceTag /></span>} icon="TrendingUp">
            <p className="mb-3 text-[11px] text-muted">Grouped by value unit — lakh and crore rows are never summed into one figure.</p>
            {data.pipelineValue.byPerson.length === 0 ? (
              <Empty label="No parseable opportunity values yet." />
            ) : (
              <div className="space-y-3">
                {data.pipelineValue.byPerson.map((p) => (
                  <div key={p.salesPersonId} className="text-[12px]">
                    <PersonName person={personOf(p.salesPersonId, p.name)} nameClassName="font-medium text-ink-900" />
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
                      {p.totalsByUnit.map((u) => (
                        <span key={u.unit}>{u.total.toLocaleString('en-IN')} {u.unit} <span className="text-[10px]">({u.count})</span></span>
                      ))}
                      {p.unparseableCount > 0 && <span className="text-amber-700">{p.unparseableCount} unparseable, excluded</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          </Can>
        </section>

        <Panel title={<span className="flex items-center gap-2">Activity volume by salesperson <ConfidenceTag /></span>} icon="Handshake">
          <p className="mb-3 text-[11px] text-muted">
            {data.activity.reliableEventCount} of {data.activity.reliableEventCount + data.activity.excludedLegacyCount} interactions have an identifiable attendee; {data.activity.excludedLegacyCount} legacy interaction{data.activity.excludedLegacyCount === 1 ? '' : 's'} without one {data.activity.excludedLegacyCount === 1 ? 'is' : 'are'} excluded rather than guessed from a name.
          </p>
          {data.activity.byPerson.length === 0 ? (
            <Empty label="No attributable activity yet." />
          ) : (
            <div className="space-y-2.5">
              {data.activity.byPerson.map((a) => (
                <Bar key={a.salesPersonId} label={a.name} person={personOf(a.salesPersonId, a.name)} value={a.count} max={maxActivity} barClass="bg-teal" />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
