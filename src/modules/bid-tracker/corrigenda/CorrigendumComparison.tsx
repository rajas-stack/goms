import { useState } from 'react'
import {
  CORRIGENDUM_IMPACT_LABELS, CORRIGENDUM_MODULE_LABELS, CORRIGENDUM_REVIEW_STATUS_LABELS, corrigendumCode, corrigendumHeading,
} from '@goms/domain'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import type { BidCorrigendum, BidDocument } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ChangeCard } from './ChangeCard'
import { corrigendumStats, formatRegisterDate } from './model'
import { IMPACT_TONE, REVIEW_STATUS_TONE, eyebrow } from './ui'

const FLAGS = [
  ['technicalImpact', 'Technical'], ['commercialImpact', 'Commercial'], ['bidDateImpact', 'Bid date'], ['submissionDateImpact', 'Submission date'],
] as const

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={cn(eyebrow, 'text-muted')}>{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] text-ink-800">{children}</dd>
    </div>
  )
}

/** The corrigendum number is the page's main heading ("CORRIGENDUM 02"), with
 *  the register summary under it and one comparison card per change. */
export function CorrigendumComparison({ corrigendum, owner, document, highlightedChangeId, onEditRegister, onDecide }: {
  corrigendum: BidCorrigendum
  owner: { name: string } | null
  document: BidDocument | null
  highlightedChangeId: string | null
  onEditRegister: () => void
  onDecide: (changeId: string, decision: 'accepted' | 'rejected') => Promise<unknown>
}) {
  const [deciding, setDeciding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { numberOfChanges, openActions } = corrigendumStats(corrigendum)
  const c = corrigendum

  async function decide(changeId: string, decision: 'accepted' | 'rejected') {
    setError(null); setDeciding(changeId)
    try { await onDecide(changeId, decision) } catch (e) { setError(e instanceof Error ? e.message : 'Could not record the decision.') } finally { setDeciding(null) }
  }

  return (
    <section aria-labelledby={`corrigendum-${c.id}-heading`} className="space-y-4">
      <header className="relative overflow-hidden rounded-2xl bg-ink-900 px-5 py-4 text-paper shadow-[0_10px_30px_-18px_rgb(var(--c-ink-900)/0.9)] sm:px-6 sm:py-5">
        <div aria-hidden className="pointer-events-none absolute -right-6 -top-10 select-none font-display text-[120px] font-bold leading-none text-paper/[0.06]">
          {corrigendumCode(c.corrigendumNumber)}
        </div>
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={`corrigendum-${c.id}-heading`} data-testid="corrigendum-heading" className="font-display text-2xl font-bold tracking-[0.08em] sm:text-[28px]">
              {corrigendumHeading(c.corrigendumNumber)}
            </h3>
            <p data-testid="corrigendum-subheading" className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-paper/75">
              <span>Published: {formatRegisterDate(c.publishedDate)}</span>
              <span aria-hidden>|</span>
              <span>{numberOfChanges} {numberOfChanges === 1 ? 'Change' : 'Changes'}</span>
              <span aria-hidden>|</span>
              <span className="font-semibold text-paper">{CORRIGENDUM_IMPACT_LABELS[c.impactLevel]} Impact</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={REVIEW_STATUS_TONE[c.reviewStatus]}>{CORRIGENDUM_REVIEW_STATUS_LABELS[c.reviewStatus]}</Badge>
            <Badge tone={openActions ? 'amber' : 'emerald'}>{openActions} open {openActions === 1 ? 'action' : 'actions'}</Badge>
            <Button size="sm" variant="secondary" onClick={onEditRegister}><Icon name="Pencil" size={13} /> Edit register</Button>
          </div>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-line bg-white px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="Received">{formatRegisterDate(c.receivedDate)}</Fact>
        <Fact label="Effective">{formatRegisterDate(c.effectiveDate)}</Fact>
        <Fact label="Review owner">{owner ? <PersonName person={owner} size="2xs" /> : '—'}</Fact>
        <Fact label="Document">{document ? <span className="inline-flex items-center gap-1"><Icon name="FileText" size={12} className="text-muted" />{document.filename}</span> : '—'}</Fact>
        <Fact label="Affected sections">{c.affectedSections.length ? c.affectedSections.map((m) => CORRIGENDUM_MODULE_LABELS[m]).join(', ') : '—'}</Fact>
        <Fact label="Impact on">
          <span className="flex flex-wrap gap-1">
            {FLAGS.map(([key, label]) => (
              <span key={key} className={cn('rounded px-1 text-[11px]', c[key] ? 'bg-amber-100 font-medium text-amber-700' : 'text-muted line-through')}>
                {label} {c[key] ? 'Y' : 'N'}
              </span>
            ))}
          </span>
        </Fact>
        {c.remarks && <div className="col-span-full"><Fact label="Remarks"><span className="whitespace-normal">{c.remarks}</span></Fact></div>}
      </dl>

      {error && <p role="alert" className="text-[13px] text-crimson">{error}</p>}
      <div className="space-y-4">
        {c.changes.map((ch, i) => (
          <ChangeCard
            key={ch.id} change={ch} index={i} highlighted={highlightedChangeId === ch.id}
            deciding={deciding === ch.id} onDecide={(d) => decide(ch.id, d)}
          />
        ))}
      </div>
    </section>
  )
}
