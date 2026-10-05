import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAllEmployees, useRelationshipAnalytics } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import { TIMELINE_META } from '@/lib/timeline-meta'
import { QUALITY_DOT } from '@/lib/node-colors'
import type { RelationshipQuality, RelationshipStatus } from '@/lib/types'
import type { InteractionSummary } from '@/data/repository'
import { StatCard, Panel, Bar, Empty, LegendRow, Donut } from './InsightsPrimitives'

const QUALITY_ORDER: RelationshipQuality[] = ['excellent', 'good', 'neutral', 'weak', 'poor']
const STATUS_ORDER: RelationshipStatus[] = ['engaged', 'developing', 'new', 'dormant']
const STATUS_BAR: Record<RelationshipStatus, string> = {
  engaged: 'bg-teal', developing: 'bg-indigo', new: 'bg-ink-900', dormant: 'bg-muted',
}

export function RelationshipAnalytics() {
  const navigate = useNavigate()
  const { data: a } = useRelationshipAnalytics()
  // Interaction rows carry only the employee id + name; the face comes from the directory.
  const { data: employees = [] } = useAllEmployees()
  const photoById = useMemo(() => new Map(employees.map((e) => [e.id, e.photoUrl] as const)), [employees])

  const openPerson = (employeeId: string) =>
    navigate(`/directory?sel=${employeeId}&kind=employee`)

  return (
    <div className="flex h-full flex-col">
      <div className="z-10 border-b border-line bg-white/80 px-4 py-4 sm:px-6">
        <span className="eyebrow">Relationships</span>
        <h1 className="font-display text-xl font-bold leading-tight text-ink-900">Relationship Analytics</h1>
        <p className="text-[12px] text-muted">Connection health, quality mix, and meetings across every state</p>
      </div>

      {!a ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">Loading analytics…</div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-4 py-4 sm:space-y-6 sm:px-6 sm:py-6"
        >
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard icon="Users" tone="emerald" label="Connected officials" value={a.connected} sub={`${a.total} total`} />
            <StatCard icon="Star" tone="crimson" label="High-priority contacts" value={a.highPriority} />
            <StatCard icon="UserX" tone="amber" label="Vacant positions" value={a.vacant} />
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Connected vs not connected" icon="PieChart">
              {/* Stacks on a phone — side-by-side, the 128px donut left the
                  legend too narrow and its "n · nn%" values overflowed. */}
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                <Donut connected={a.connected} notConnected={a.notConnected} />
                <div className="w-full min-w-0 space-y-2 sm:w-auto sm:flex-1">
                  <LegendRow swatch="bg-emerald" label="Connected" value={a.connected} total={a.total} />
                  <LegendRow swatch="bg-line" label="Not connected" value={a.notConnected} total={a.total} />
                  <LegendRow swatch="bg-amber" label="Vacant (excluded)" value={a.vacant} />
                </div>
              </div>
            </Panel>

            <Panel title="Relationship quality" icon="BarChart3">
              <div className="space-y-2.5">
                {QUALITY_ORDER.map((q) => (
                  <Bar key={q} label={q} value={a.qualityDist[q]} max={a.connected} barClass={QUALITY_DOT[q]} />
                ))}
              </div>
            </Panel>
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Engagement status" icon="Handshake">
              <div className="space-y-2.5">
                {STATUS_ORDER.map((s) => (
                  <Bar key={s} label={s} value={a.statusDist[s]} max={a.connected} barClass={STATUS_BAR[s]} />
                ))}
              </div>
            </Panel>

            <Panel title={`Upcoming meetings · ${a.upcomingMeetings.length}`} icon="CalendarClock">
              {a.upcomingMeetings.length === 0 ? (
                <Empty label="No meetings scheduled." />
              ) : (
                <div className="space-y-1.5">
                  {a.upcomingMeetings.map((it, i) => (
                    <InteractionRow key={`${it.employeeId}-${i}`} it={it} photoUrl={photoById.get(it.employeeId) ?? null} onClick={() => openPerson(it.employeeId)} />
                  ))}
                </div>
              )}
            </Panel>
          </section>

          <Panel title={`Recent interactions · ${a.recentInteractions.length}`} icon="Clock">
            {a.recentInteractions.length === 0 ? (
              <Empty label="No logged interactions yet." />
            ) : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {a.recentInteractions.map((it, i) => (
                  <InteractionRow key={`${it.employeeId}-${i}`} it={it} photoUrl={photoById.get(it.employeeId) ?? null} onClick={() => openPerson(it.employeeId)} />
                ))}
              </div>
            )}
          </Panel>
        </motion.div>
      )}
    </div>
  )
}

function InteractionRow({ it, photoUrl, onClick }: { it: InteractionSummary; photoUrl: string | null; onClick: () => void }) {
  const meta = TIMELINE_META[it.type]
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-left transition-colors hover:border-ink-600">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white">
        <Icon name={meta.icon} size={14} className="text-ink-700" />
      </span>
      <span className="min-w-0 flex-1">
        <PersonName person={{ name: it.name, photoUrl }} className="max-w-full text-[13px] font-medium text-ink-900" />
        <span className="block break-words text-[11px] text-muted">{it.title}</span>
      </span>
      <span className="shrink-0 text-[11px] text-muted">{it.date}</span>
    </button>
  )
}
