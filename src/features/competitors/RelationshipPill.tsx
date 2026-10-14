import { COMPETITOR_RELATIONSHIP_LABEL, type CompetitorRelationship } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

/** Tone and icon per relationship, from the shared theme palette. */
export const RELATIONSHIP_META: Record<CompetitorRelationship, { icon: string; tone: string }> = {
  competitor: { icon: 'Flag', tone: 'bg-rose-50 text-rose-700 border-rose-700/20' },
  partner: { icon: 'Handshake', tone: 'bg-emerald-50 text-emerald-700 border-emerald-700/20' },
  neutral: { icon: 'Circle', tone: 'bg-panel text-muted border-line' },
  strategicThreat: { icon: 'ShieldAlert', tone: 'bg-crimson-100 text-crimson border-crimson/30' },
}

export function RelationshipPill({ relationship, className }: { relationship: CompetitorRelationship; className?: string }) {
  const meta = RELATIONSHIP_META[relationship]
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-medium', meta.tone, className)}>
      <Icon name={meta.icon} size={12} />{COMPETITOR_RELATIONSHIP_LABEL[relationship]}
    </span>
  )
}
