import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import type { AvatarPerson } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'

export function StatCard({ icon, label, value, sub, tone }: {
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

export function Panel({ title, icon, children }: { title: React.ReactNode; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-white p-4 shadow-panel sm:p-5">
      <h3 className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-ink-800">
        <Icon name={icon} size={15} className="text-muted" />{title}
      </h3>
      {children}
    </div>
  )
}

export function Donut({ connected, notConnected }: { connected: number; notConnected: number }) {
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

export function LegendRow({ swatch, label, value, total }: { swatch: string; label: string; value: number; total?: number }) {
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

/** `person` marks the label as a human's name — their face is shown beside it
 *  (the label column widens to fit the avatar). */
export function Bar({ label, value, max, barClass, person }: {
  label: string; value: number; max: number; barClass: string; person?: AvatarPerson
}) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      {person ? (
        <PersonName person={{ ...person, name: label }} size="2xs" className="w-32 shrink-0 text-[12px] text-muted" />
      ) : (
        <span className="w-20 shrink-0 text-[12px] capitalize text-muted">{label}</span>
      )}
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-panel">
        <div className={cn('h-full rounded-full transition-all', barClass)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-[12px] font-medium text-ink-900">{value}</span>
    </div>
  )
}

export function Empty({ label }: { label: string }) {
  return <p className="text-sm text-muted">{label}</p>
}
