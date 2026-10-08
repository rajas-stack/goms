import { useMemo } from 'react'
import { CORRIGENDUM_CLASSIFICATION_LABELS, CORRIGENDUM_IMPACT_LABELS, CORRIGENDUM_MODULE_LABELS } from '@goms/domain'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import type { BidCorrigendumChange } from '@/lib/types'
import { cn } from '@/lib/utils'
import { DiffText, WhatChanged } from './DiffText'
import { diffText } from './textDiff'
import { CLASSIFICATION_TONE, IMPACT_TONE, displayValue, eyebrow } from './ui'

const DECISION_BADGE = {
  pending: null, accepted: <Badge tone="emerald"><Icon name="Check" size={11} /> Accepted</Badge>,
  rejected: <Badge tone="gray">Rejected — not applied</Badge>,
} as const

/** One change of a corrigendum as a comparison card: clause title, ORIGINAL
 *  → MODIFIED side by side (stacked below `lg`), WHAT CHANGED, then
 *  classification / impact / source. Only the changed words are coloured. */
export function ChangeCard({ change, index, highlighted, onDecide, deciding }: {
  change: BidCorrigendumChange
  index: number
  highlighted?: boolean
  onDecide?: (decision: 'accepted' | 'rejected') => void
  deciding?: boolean
}) {
  const diff = useMemo(
    () => diffText(displayValue(change, change.currentValue), displayValue(change, change.proposedValue)),
    [change],
  )
  const moduleLabel = CORRIGENDUM_MODULE_LABELS[change.affectedModule]
  return (
    <article
      id={`corrigendum-change-${change.id}`}
      data-testid="change-card"
      aria-labelledby={`corrigendum-change-${change.id}-title`}
      className={cn(
        'neu-raised scroll-mt-24 rounded-2xl border border-transparent p-4 transition-shadow sm:p-5',
        highlighted && 'border-blue/60 ring-2 ring-blue/40 ring-offset-2 ring-offset-paper',
        change.decision === 'rejected' && 'opacity-70',
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="mt-0.5 flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded-lg bg-ink-900 px-1.5 font-mono text-[12px] font-semibold text-paper">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className="min-w-0">
            <h4 id={`corrigendum-change-${change.id}-title`} className="font-display text-[15px] font-semibold leading-snug text-ink-900">
              {change.clauseTitle}
            </h4>
            <div className="mt-0.5 text-[12px] text-muted">{moduleLabel} module</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={CLASSIFICATION_TONE[change.classification]}>{CORRIGENDUM_CLASSIFICATION_LABELS[change.classification]}</Badge>
          <Badge tone={IMPACT_TONE[change.impactLevel]}>{CORRIGENDUM_IMPACT_LABELS[change.impactLevel]} impact</Badge>
          {DECISION_BADGE[change.decision]}
        </div>
      </header>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
        <section aria-label="Original clause" data-testid="original-clause" className="neu-inset rounded-xl p-3.5">
          <div className={cn(eyebrow, 'mb-1.5 text-muted')}>Original clause</div>
          {change.currentValue ? <DiffText segments={diff.original} className="text-ink-700" /> : <p className="text-[13px] italic text-muted">Not in the tender before this corrigendum</p>}
        </section>
        <div aria-hidden className="flex items-center justify-center text-muted">
          <span className="flex h-8 w-8 items-center justify-center rounded-full neu-raised-sm">
            <Icon name="ArrowRight" size={15} className="rotate-90 lg:rotate-0" />
          </span>
        </div>
        <section aria-label="Modified clause" data-testid="modified-clause" className="rounded-xl border border-blue/40 bg-white p-3.5 shadow-[0_1px_0_rgb(var(--c-blue)/0.15),0_6px_18px_-10px_rgb(var(--c-blue)/0.45)]">
          <div className={cn(eyebrow, 'mb-1.5 text-blue')}>Modified clause</div>
          {change.proposedValue ? <DiffText segments={diff.modified} className="text-ink-900" /> : <p className="text-[13px] italic text-crimson">Clause deleted</p>}
        </section>
      </div>

      <div className="mt-4 space-y-3 border-t border-line pt-3">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
          <div className={cn(eyebrow, 'shrink-0 pt-1.5 text-muted sm:w-28')}>What changed</div>
          <WhatChanged hunks={diff.hunks} />
        </div>
        <dl className="grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-[auto_1fr]">
          <dt className={cn(eyebrow, 'pt-0.5 text-muted sm:w-28')}>Classification</dt>
          <dd className="text-ink-800" data-testid="classification">
            {moduleLabel} <span className="text-edge">|</span> {change.clauseTitle} <span className="text-edge">|</span> {CORRIGENDUM_CLASSIFICATION_LABELS[change.classification]}
          </dd>
          <dt className={cn(eyebrow, 'pt-0.5 text-muted')}>Impact</dt>
          <dd className="text-ink-800">{CORRIGENDUM_IMPACT_LABELS[change.impactLevel]}</dd>
          <dt className={cn(eyebrow, 'pt-0.5 text-muted')}>Source</dt>
          <dd className="inline-flex items-center gap-1.5 text-ink-800">
            <Icon name="FileText" size={13} className="text-muted" />{change.sourceRef || 'Not recorded'}
          </dd>
        </dl>
        {change.decision === 'pending' && onDecide && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-[12px] text-muted">
              {change.kind === 'field' ? 'Accepting applies this date to the bid.' : 'Awaiting review.'}
            </span>
            <Button size="sm" variant="ghost" disabled={deciding} onClick={() => onDecide('rejected')}>Reject</Button>
            <Button size="sm" variant="secondary" disabled={deciding} onClick={() => onDecide('accepted')}><Icon name="Check" size={13} /> Accept</Button>
          </div>
        )}
      </div>
    </article>
  )
}
