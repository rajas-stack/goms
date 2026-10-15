import { useMemo } from 'react'
import { corrigendumCode } from '@goms/domain'
import { Badge } from '@/components/ui/Badge'
import { useBidCorrigenda } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DiffText } from '../corrigenda/DiffText'
import { diffText } from '../corrigenda/textDiff'
import { buildTenderPosition, type ClauseHistory } from '../corrigenda/tenderPosition'
import { eyebrow } from '../corrigenda/ui'

/** SOW clauses changed by corrigenda, side by side: Original | After C#.
 *  The rich Scope document itself is never diffed — only the recorded clauses. */
export function sowClauses(histories: readonly ClauseHistory[]): ClauseHistory[] {
  return histories.filter((h) => h.module === 'sow' && h.versions.length > 0)
}

function SowRow({ h }: { h: ClauseHistory }) {
  const source = h.current.source
  const diff = diffText(h.original, h.current.value)
  return (
    <li data-testid="sow-change" className="grid gap-3 border-t border-line px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,14rem)_1fr_1fr]">
      <div className="min-w-0">
        <p className="break-words text-[13px] font-semibold text-ink-900">{h.title}</p>
        {source
          ? <Badge tone="blue" className="mt-1">Updated through {corrigendumCode(source.corrigendumNumber)}</Badge>
          : <Badge tone="gray" className="mt-1">Rejected — original stands</Badge>}
      </div>
      <div className="min-w-0">
        <div className={cn(eyebrow, 'mb-1 text-muted md:hidden')}>Original</div>
        {h.original ? <DiffText segments={diff.original} className="text-[13px]" /> : <p className="text-[13px] italic text-muted">Not in the original tender</p>}
      </div>
      <div className="min-w-0">
        <div className={cn(eyebrow, 'mb-1 text-muted md:hidden')}>After {source ? corrigendumCode(source.corrigendumNumber) : '—'}</div>
        {!source ? <p className="text-[13px] text-muted">No change in effect</p>
          : h.current.value ? <DiffText segments={diff.modified} className="text-[13px]" />
            : <p className="text-[13px] italic text-crimson">Deleted</p>}
      </div>
    </li>
  )
}

export function SowCorrigendumPanel({ bidId }: { bidId: string }) {
  const { data: corrigenda = [] } = useBidCorrigenda(bidId)
  const clauses = useMemo(() => sowClauses(buildTenderPosition(corrigenda)), [corrigenda])
  if (!clauses.length) return null
  return (
    <section aria-labelledby="sow-corrigendum-heading" className="m-4 overflow-hidden rounded-xl border border-line bg-white" data-testid="sow-corrigendum-panel">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-blue-50 px-4 py-2.5">
        <h3 id="sow-corrigendum-heading" className="text-[13px] font-semibold text-ink-900">Corrigendum changes · Scope of Work</h3>
        <span className="text-[12px] text-muted">{clauses.length} clause{clauses.length === 1 ? '' : 's'} · only changed words are highlighted</span>
      </header>
      <div className={cn(eyebrow, 'hidden gap-3 border-b border-line px-4 py-1.5 text-muted md:grid md:grid-cols-[minmax(0,14rem)_1fr_1fr]')}>
        <span>Clause</span><span>Original</span><span>After corrigendum</span>
      </div>
      <ul>{clauses.map((h) => <SowRow key={h.key} h={h} />)}</ul>
    </section>
  )
}
