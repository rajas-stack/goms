import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useRelationshipAnalytics } from '@/lib/api'
import { Icon } from '@/components/ui/Icon'
import { Badge } from '@/components/ui/Badge'
import { TIMELINE_META } from '@/lib/timeline-meta'
import { QUALITY_DOT } from '@/lib/node-colors'
import { cn, initials } from '@/lib/utils'
import type { RelationshipQuality, RelationshipStatus } from '@/lib/types'
import type { FollowUpSummary, InteractionSummary } from '@/data/repository'

const QUALITY_ORDER: RelationshipQuality[] = ['excellent', 'good', 'neutral', 'weak', 'poor']
const STATUS_ORDER: RelationshipStatus[] = ['engaged', 'developing', 'new', 'dormant']
const STATUS_BAR: Record<RelationshipStatus, string> = {
  engaged: 'bg-teal', developing: 'bg-indigo', new: 'bg-ink-900', dormant: 'bg-muted',
}

export function RelationshipAnalytics() {
  const navigate = useNavigate()
  const { data: a } = useRelationshipAnalytics()

  const openPerson = (employeeId: string) =>
    navigate(`/directory?sel=${employeeId}&kind=employee`)

  return (
    <div className="flex h-full flex-col">
      <div className="z-10 border-b border-line bg-white/80 px-6 py-4 backdrop-blur">
        <span className="eyebrow">Relationships</span>
        <h1 className="font-display text-xl font-bold leading-tight text-ink-900">Relationship Analytics</h1>
        <p className="text-[12px] text-muted">Connection health, quality mix, and follow-ups across every state</p>
      </div>

      {!a ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">Loading analytics…</div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="min-h-0 flex-1 space-y-6 overflow-y-auto scrollbar-thin px-6 py-6"
        >
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon="Users" tone="emerald" label="Connected officials" value={a.connected} sub={`${a.total} total`} />
            <StatCard icon="CalendarClock" tone="amber" label="Follow-ups due" value={a.followUpsDue} />
            <StatCard icon="Star" tone="crimson" label="High-priority contacts" value={a.highPriority} />
            <StatCard icon="UserX" tone="amber" label="Vacant positions" value={a.vacant} />
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Connected vs not connected" icon="PieChart">
              <div className="flex items-center gap-6">
                <Donut connected={a.connected} notConnected={a.notConnected} />
                <div className="space-y-2">
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

            <Panel title={`Upcoming follow-ups · ${a.upcomingFollowUps.length}`} icon="CalendarClock">
              {a.upcomingFollowUps.length === 0 ? (
                <Empty label="No follow-ups scheduled." />
              ) : (
                <div className="space-y-1">
                  {a.upcomingFollowUps.map((f) => <FollowUpRow key={f.employeeId} f={f} onClick={() => openPerson(f.employeeId)} />)}
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
                  <InteractionRow key={`${it.employeeId}-${i}`} it={it} onClick={() => openPerson(it.employeeId)} />
                ))}
              </div>
            )}
          </Panel>
        </motion.div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, sub, tone }: {
  icon: string; label: string; value: number; sub?: string
  tone: 'emerald' | 'amber' | 'crimson' | 'indigo'
}) {
  const tones = {
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    crimson: 'bg-crimson-100 text-crimson',
    indigo: 'bg-indigo-100 text-indigo-600',
  }
  return (
    <div className="rounded-card border border-line bg-white p-4 shadow-panel">
      <div className="flex items-center justify-between">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', tones[tone])}>
          <Icon name={icon} size={17} />
        </span>
      </div>
      <div className="mt-3 font-display text-2xl font-bold text-ink-900">{value}</div>
      <div className="text-[12px] text-muted">{label}{sub ? ` · ${sub}` : ''}</div>
    </div>
  )
}

function Panel({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-white p-5 shadow-panel">
      <h3 className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-ink-800">
        <Icon name={icon} size={15} className="text-muted" />{title}
      </h3>
      {children}
    </div>
  )
}

function Donut({ connected, notConnected }: { connected: number; notConnected: number }) {
  const total = connected + notConnected
  const pct = total > 0 ? (connected / total) * 100 : 0
  const deg = (pct / 100) * 360
  return (
    <div className="relative h-32 w-32 shrink-0">
      <div
        className="h-32 w-32 rounded-full"
        style={{ background: `conic-gradient(#2F8F5B 0deg ${deg}deg, #DDE3EC ${deg}deg 360deg)` }}
      />
      <div className="absolute inset-[18px] flex flex-col items-center justify-center rounded-full bg-white">
        <span className="font-display text-xl font-bold text-ink-900">{Math.round(pct)}%</span>
        <span className="text-[10px] text-muted">connected</span>
      </div>
    </div>
  )
}

function LegendRow({ swatch, label, value, total }: { swatch: string; label: string; value: number; total?: number }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span className={cn('h-2.5 w-2.5 rounded-sm', swatch)} />
      <span className="text-ink-800">{label}</span>
      <span className="ml-auto font-medium text-ink-900">
        {value}{total ? <span className="text-muted"> · {total ? Math.round((value / total) * 100) : 0}%</span> : ''}
      </span>
    </div>
  )
}

function Bar({ label, value, max, barClass }: { label: string; value: number; max: number; barClass: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[12px] capitalize text-muted">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-panel">
        <div className={cn('h-full rounded-full transition-all', barClass)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-[12px] font-medium text-ink-900">{value}</span>
    </div>
  )
}

function FollowUpRow({ f, onClick }: { f: FollowUpSummary; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink-900/[0.04]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 font-mono text-[11px] font-semibold text-emerald-600">
        {initials(f.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink-900">{f.name}</span>
        <span className="block truncate text-[11px] text-muted">{f.designation}</span>
      </span>
      <Badge tone={f.overdue ? 'crimson' : 'amber'}>{f.overdue ? 'Overdue' : f.date}</Badge>
    </button>
  )
}

function InteractionRow({ it, onClick }: { it: InteractionSummary; onClick: () => void }) {
  const meta = TIMELINE_META[it.type]
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-left transition-colors hover:border-ink-600">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white">
        <Icon name={meta.icon} size={14} className="text-ink-700" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink-900">{it.name}</span>
        <span className="block truncate text-[11px] text-muted">{it.title}</span>
      </span>
      <span className="shrink-0 text-[11px] text-muted">{it.date}</span>
    </button>
  )
}

function Empty({ label }: { label: string }) {
  return <p className="text-sm text-muted">{label}</p>
}
