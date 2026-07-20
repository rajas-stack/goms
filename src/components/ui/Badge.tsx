import { cn } from '@/lib/utils'
import { QUALITY_DOT } from '@/lib/node-colors'
import type { Charge, Employee, RelationshipQuality, RelationshipStatus } from '@/lib/types'

export function CodeChip({ code, className }: { code: string | null; className?: string }) {
  if (!code) return null
  return <span className={cn('code-chip', className)}>{code}</span>
}

export type BadgeTone =
  | 'neutral' | 'teal' | 'indigo' | 'crimson' | 'ink'
  | 'blue' | 'purple' | 'emerald' | 'amber' | 'gray'

export function Badge({ children, tone = 'neutral', className }: {
  children: React.ReactNode
  tone?: BadgeTone
  className?: string
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'bg-ink-900/[0.06] text-ink-700',
    teal: 'bg-teal-100 text-teal-600',
    indigo: 'bg-indigo-100 text-indigo-600',
    crimson: 'bg-crimson-100 text-crimson',
    ink: 'bg-ink-900 text-paper',
    blue: 'bg-blue-100 text-blue-600',
    purple: 'bg-purple-100 text-purple-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    gray: 'bg-panel text-muted',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', tones[tone], className)}>
      {children}
    </span>
  )
}

const STATUS_TONE: Record<RelationshipStatus, BadgeTone> = {
  engaged: 'teal', developing: 'indigo', dormant: 'neutral', new: 'ink',
}
const QUALITY_TONE: Record<RelationshipQuality, BadgeTone> = {
  excellent: 'emerald', good: 'teal', neutral: 'neutral', weak: 'amber', poor: 'crimson',
}

/** Small color-coded quality indicator: a dot plus the (capitalized) label. */
export function QualityBadge({ quality }: { quality: RelationshipQuality }) {
  return (
    <Badge tone={QUALITY_TONE[quality]} className="capitalize">
      <span className={cn('h-1.5 w-1.5 rounded-full', QUALITY_DOT[quality])} />
      {quality}
    </Badge>
  )
}

export function StatusBadge({ status }: { status: RelationshipStatus }) {
  return <Badge tone={STATUS_TONE[status]} className="capitalize">{status}</Badge>
}

export function RelationshipBadges({ status, quality }: { status: RelationshipStatus; quality: RelationshipQuality }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <StatusBadge status={status} />
      <QualityBadge quality={quality} />
    </div>
  )
}

export function ConnectionBadge({ connected }: { connected: boolean }) {
  return connected
    ? <Badge tone="emerald">Connected: Yes</Badge>
    : <Badge tone="gray">Connected: No</Badge>
}

export function ImportantBadge() {
  return <Badge tone="amber">★ Priority</Badge>
}

export function ChargeBadge({ charge }: { charge: Pick<Charge, 'kind' | 'title'> }) {
  return (
    <Badge tone={charge.kind === 'acting' ? 'purple' : 'blue'}>
      {charge.kind === 'acting' ? 'Acting' : 'Addl'} · {charge.title}
    </Badge>
  )
}

export function VacantBadge() {
  return <Badge tone="amber">Vacant</Badge>
}

/** Compact one-line relationship summary shown on a person's card. */
export function RelationshipSummary({ employee }: { employee: Employee }) {
  if (employee.vacant) return null
  if (!employee.connected) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <ConnectionBadge connected={false} />
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <QualityBadge quality={employee.relationshipQuality} />
      <StatusBadge status={employee.relationshipStatus} />
      {employee.importantContact && <ImportantBadge />}
    </div>
  )
}
