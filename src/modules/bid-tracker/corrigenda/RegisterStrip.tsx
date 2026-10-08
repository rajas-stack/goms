import {
  CORRIGENDUM_IMPACT_LABELS, CORRIGENDUM_REVIEW_STATUS_LABELS, corrigendumCode,
} from '@goms/domain'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import type { BidCorrigendum } from '@/lib/types'
import { cn } from '@/lib/utils'
import { corrigendumStats, formatRegisterDate } from './model'
import { IMPACT_TONE, REVIEW_STATUS_TONE } from './ui'

/** The corrigendum register as a row of selectable entries (C1, C2, …), each
 *  summarising impact, review status and the derived change / open-action counts. */
export function RegisterStrip({ corrigenda, selectedId, ownerName, onSelect }: {
  corrigenda: BidCorrigendum[]
  selectedId: string | null
  ownerName: (id: string | null) => string | null
  onSelect: (id: string) => void
}) {
  return (
    <div role="tablist" aria-label="Corrigendum register" className="flex gap-3 overflow-x-auto px-1 pb-2 pt-1 scrollbar-thin">
      {corrigenda.map((c) => {
        const { numberOfChanges, openActions } = corrigendumStats(c)
        const selected = c.id === selectedId
        const owner = ownerName(c.reviewOwnerId)
        return (
          <button
            key={c.id} type="button" role="tab" aria-selected={selected} data-testid="register-entry"
            onClick={() => onSelect(c.id)}
            className={cn(
              'neu-raised min-w-[220px] rounded-2xl border px-3.5 py-3 text-left transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 focus-visible:focus-ring',
              selected ? 'border-ink-900/70 ring-2 ring-ink-900/20 ring-offset-2 ring-offset-paper' : 'border-transparent',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-xl font-bold tracking-wide text-ink-900">{corrigendumCode(c.corrigendumNumber)}</span>
              <Badge tone={IMPACT_TONE[c.impactLevel]}>{CORRIGENDUM_IMPACT_LABELS[c.impactLevel]}</Badge>
            </div>
            <div className="mt-0.5 text-[12px] text-muted">Published {formatRegisterDate(c.publishedDate)}</div>
            <div className="mt-2 flex items-center gap-3 text-[12px] tabular-nums">
              <span><strong className="text-ink-900">{numberOfChanges}</strong> <span className="text-muted">changes</span></span>
              <span className={openActions ? 'text-amber-700' : 'text-muted'}><strong>{openActions}</strong> open</span>
              {owner && <Avatar person={{ name: owner }} size="2xs" className="ml-auto" />}
            </div>
            <div className="mt-2"><Badge tone={REVIEW_STATUS_TONE[c.reviewStatus]}>{CORRIGENDUM_REVIEW_STATUS_LABELS[c.reviewStatus]}</Badge></div>
          </button>
        )
      })}
    </div>
  )
}
