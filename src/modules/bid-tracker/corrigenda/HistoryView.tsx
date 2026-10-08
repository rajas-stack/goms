import { Fragment } from 'react'
import { CORRIGENDUM_CLASSIFICATION_LABELS, CORRIGENDUM_MODULE_LABELS, corrigendumCode } from '@goms/domain'
import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { DiffText } from './DiffText'
import { formatRegisterDate } from './model'
import { diffText } from './textDiff'
import type { ClauseHistory, ClauseVersion } from './tenderPosition'
import type { OpenSource } from './TenderPositionView'
import { CLASSIFICATION_TONE, displayValue, eyebrow } from './ui'

function Node({ tone, children }: { tone: 'origin' | 'version' | 'current' | 'rejected'; children: React.ReactNode }) {
  return (
    <li className="relative pb-4 pl-7 last:pb-0">
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2',
          tone === 'origin' && 'border-ink-600 bg-white',
          tone === 'version' && 'border-blue bg-blue-100',
          tone === 'rejected' && 'border-line bg-panel',
          tone === 'current' && 'border-emerald bg-emerald shadow-[0_0_0_4px_rgb(var(--c-emerald)/0.18)]',
        )}
      />
      {children}
    </li>
  )
}

function VersionNode({ h, v, onOpenSource }: { h: ClauseHistory; v: ClauseVersion; onOpenSource: OpenSource }) {
  const diff = diffText(displayValue(h, v.before), displayValue(h, v.after))
  const rejected = v.decision === 'rejected'
  return (
    <Node tone={rejected ? 'rejected' : 'version'}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button" onClick={() => onOpenSource(v.corrigendumId, v.changeId)}
          className="rounded-md bg-blue-50 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-blue-700 hover:bg-blue-100 focus-visible:focus-ring"
          aria-label={`Open ${corrigendumCode(v.corrigendumNumber)} comparison`}
        >
          {corrigendumCode(v.corrigendumNumber)}
        </button>
        <span className="text-[12px] text-muted">{formatRegisterDate(v.publishedDate)}</span>
        <Badge tone={CLASSIFICATION_TONE[v.classification]}>{CORRIGENDUM_CLASSIFICATION_LABELS[v.classification]}</Badge>
        {rejected && <Badge tone="gray">Rejected — not in effect</Badge>}
      </div>
      <DiffText segments={diff.modified} className={cn('mt-1', rejected && 'text-muted line-through')} />
    </Node>
  )
}

/** History View: Original Tender → C1 → C2 → … → Current Effective, per
 *  clause. Each version highlights only what it changed versus the one before. */
export function HistoryView({ chain, clauses, onOpenSource }: { chain: string[]; clauses: ClauseHistory[]; onOpenSource: OpenSource }) {
  return (
    <div className="space-y-4" data-testid="history-view">
      <ol aria-label="Version chain" className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium">
        {chain.map((step, i) => (
          <Fragment key={step}>
            {i > 0 && <Icon name="ChevronRight" size={14} className="text-edge" />}
            <li className={cn(
              'rounded-full px-2.5 py-1',
              i === 0 ? 'neu-inset text-ink-700' : i === chain.length - 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-50 text-blue-700',
            )}>{step}</li>
          </Fragment>
        ))}
      </ol>
      <div className="grid gap-4 xl:grid-cols-2">
        {clauses.map((h) => (
          <section key={h.key} data-testid="history-clause" aria-label={`${h.title} history`} className="neu-raised rounded-2xl p-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h4 className="font-display text-[14px] font-semibold text-ink-900">{h.title}</h4>
              <span className={cn(eyebrow, 'text-muted')}>{CORRIGENDUM_MODULE_LABELS[h.module]}</span>
            </div>
            <ol className="relative before:absolute before:bottom-2 before:left-[6px] before:top-2 before:w-px before:bg-line">
              <Node tone="origin">
                <div className={cn(eyebrow, 'text-muted')}>Original tender</div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-700" data-testid="history-original">
                  {displayValue(h, h.original) || <span className="italic">Not in the original tender</span>}
                </p>
              </Node>
              {h.versions.map((v) => <VersionNode key={v.changeId} h={h} v={v} onOpenSource={onOpenSource} />)}
              <Node tone="current">
                <div className={cn(eyebrow, 'text-emerald-700')}>Current effective</div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] font-medium leading-relaxed text-ink-900">
                  {displayValue(h, h.current.value) || <span className="italic text-muted">Deleted</span>}
                </p>
              </Node>
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}
