import { useEffect, useState } from 'react'
import { animate, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { billCoverage, claimTotal, CLAIM_STATUSES, formatINR, monthLabel, sheetDate, statusIndex, type Claim, type ClaimStatus } from './model'

function useCountUp(value: number) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(value)
  useEffect(() => {
    if (reduce) { setShown(value); return }
    const controls = animate(shown, value, { duration: 0.6, ease: [0.16, 1, 0.3, 1], onUpdate: setShown })
    return () => controls.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animate from whatever is on screen
  }, [value, reduce])
  return shown
}

/** The big top-right card: running amount, submission date, bill coverage. */
export function ClaimTotalCard({ claim }: { claim: Claim }) {
  const total = useCountUp(claimTotal(claim))
  const { covered, needed } = billCoverage(claim)
  const ratio = needed ? covered / needed : 1
  const ready = claim.expenses.length > 0 && ratio === 1 && claim.status === 'collecting'
  const submitted = claim.statusDates.submitted
  const C = 2 * Math.PI * 22
  return (
    <section aria-label="Claim total"
      className={cn('relative min-w-[280px] overflow-hidden rounded-2xl bg-ink-900 p-5 text-paper shadow-panel transition-shadow', ready && 'ring-2 ring-emerald ring-offset-2 ring-offset-paper')}>
      <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-indigo/30 blur-2xl" aria-hidden />
      <p className="text-[11px] uppercase tracking-[0.14em] text-paper/60">{monthLabel(claim.month)} · running total</p>
      <p className="mt-1 text-[40px] font-semibold leading-none tabular-nums" aria-live="polite">{formatINR(Math.round(total * 100) / 100)}</p>
      <div className="mt-4 flex items-end justify-between gap-4">
        <dl className="space-y-1 text-[12px]">
          <div><dt className="inline text-paper/60">Submission date </dt><dd className="inline font-medium">{submitted ? sheetDate(submitted) : 'Not submitted yet'}</dd></div>
          <div><dt className="inline text-paper/60">Rows </dt><dd className="inline font-medium">{claim.expenses.length}</dd></div>
          <div><dt className="inline text-paper/60">Status </dt><dd className="inline font-medium">{CLAIM_STATUSES[statusIndex(claim.status)].label}</dd></div>
        </dl>
        <div className="relative h-14 w-14 shrink-0" title={`${covered} of ${needed} bills attached`}>
          <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90" aria-hidden>
            <circle cx="28" cy="28" r="22" fill="none" strokeWidth="5" className="stroke-paper/15" />
            <circle cx="28" cy="28" r="22" fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - ratio)}
              className={cn('transition-[stroke-dashoffset] duration-700', ratio === 1 ? 'stroke-emerald' : 'stroke-amber')} />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold">{needed ? `${covered}/${needed}` : '—'}</span>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-paper/70">{ready ? '✓ Every bill is in — ready to submit' : needed > covered ? `${needed - covered} ${needed - covered === 1 ? 'bill' : 'bills'} to attach` : 'Bills appear here as you attach them'}</p>
    </section>
  )
}

/** Collecting → Submitted → HOD → Admin → Finance → Credited → Closed, with the date each step was reached. */
export function StatusTracker({ claim, onChange }: { claim: Claim; onChange: (status: ClaimStatus) => void }) {
  const current = statusIndex(claim.status)
  const next = CLAIM_STATUSES[current + 1]
  const missing = billCoverage(claim)
  return (
    <section aria-label="Claim status" className="flex flex-1 flex-col justify-between gap-2 rounded-2xl border border-line bg-white px-4 py-3">
      <ol className="flex items-start gap-1 overflow-x-auto px-0.5 py-1">
        {CLAIM_STATUSES.map((s, i) => {
          const done = i < current, here = i === current, date = claim.statusDates[s.value]
          return (
            <li key={s.value} className="flex min-w-[72px] flex-1 flex-col items-center text-center" aria-current={here ? 'step' : undefined}>
              <div className="flex w-full items-center">
                <span className={cn('h-0.5 flex-1', i === 0 ? 'opacity-0' : done || here ? 'bg-ink-900' : 'bg-line')} />
                <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-[11px] font-semibold transition-all',
                  done ? 'border-ink-900 bg-ink-900 text-paper' : here ? 'scale-110 border-indigo bg-indigo text-white shadow-sm' : 'border-line bg-white text-muted')}>
                  {done ? <Icon name="Check" size={13} /> : i + 1}
                </span>
                <span className={cn('h-0.5 flex-1', i === CLAIM_STATUSES.length - 1 ? 'opacity-0' : done ? 'bg-ink-900' : 'bg-line')} />
              </div>
              <span className={cn('mt-1.5 px-0.5 text-[12px] font-medium leading-tight', here ? 'text-ink-900' : 'text-muted')}>{s.label}</span>
              <span className="px-0.5 text-[11px] leading-tight text-muted">{date ? sheetDate(date) : here ? s.hint : ''}</span>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
        {next && <Button variant="primary" size="sm" disabled={claim.status === 'collecting' && claim.expenses.length === 0} onClick={() => onChange(next.value)}>
          <Icon name="ArrowRight" size={14} />{claim.status === 'collecting' ? 'Mark as submitted' : `Mark: ${next.label}`}
        </Button>}
        {current > 0 && <Button variant="ghost" size="sm" onClick={() => onChange(CLAIM_STATUSES[current - 1].value)}><Icon name="RotateCcw" size={14} />Step back</Button>}
        {claim.status === 'collecting' && missing.needed > missing.covered && <span className="text-[12px] text-amber-800">{missing.needed - missing.covered} rows still need a bill before you submit.</span>}
        {claim.status !== 'collecting' && <span className="text-[12px] text-muted">Rows are locked after submission. Step back to Collecting to edit.</span>}
      </div>
    </section>
  )
}
