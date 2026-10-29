import { Fragment } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { billState, formatINR, orderedRows, rateOf, sheetDate, type Claim } from './model'

/** The month's rows in claim order, grouped by trip with a subtotal per trip. */
export function ExpenseTable({ claim, selectedId, onSelect, onDelete }: {
  claim: Claim
  selectedId: string | null
  onSelect: (id: string) => void
  /** Absent once the claim is submitted (rows are locked). */
  onDelete?: (id: string) => void
}) {
  const rows = orderedRows(claim)
  if (!rows.length) return (
    <div className="rounded-2xl border border-dashed border-line bg-white/60 p-10 text-center">
      <Icon name="Sparkles" size={22} className="mx-auto text-indigo" />
      <p className="mt-2 text-[15px] font-medium text-ink-900">Nothing claimed for this month yet</p>
      <p className="text-[13px] text-muted">Add your first expense above — every cab ride, stay and printout adds up.</p>
    </div>
  )
  const trips = [...new Set(rows.map((r) => r.expense.trip))]
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-panel">
      <table className="w-full min-w-[860px] text-[13px]">
        <thead className="bg-panel/70 text-left text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Rec</th><th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Particulars</th><th className="px-3 py-2 font-medium">Mode</th>
            <th className="px-3 py-2 text-right font-medium">Kms</th><th className="px-3 py-2 text-right font-medium">Rate</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2 font-medium">Remarks</th>
            <th className="px-3 py-2 font-medium">Bills</th>
            {onDelete && <th className="w-10 px-2 py-2"><span className="sr-only">Delete</span></th>}
          </tr>
        </thead>
        <tbody>
          {trips.map((trip) => {
            const tripRows = rows.filter((r) => r.expense.trip === trip)
            const subtotal = tripRows.reduce((s, r) => s + r.expense.amount, 0)
            return (
              <Fragment key={trip}>
                <tr className="border-t border-line bg-ink-900/[0.025]">
                  <td colSpan={6} className="px-3 py-1.5 text-[12px] font-semibold text-ink-800">{trip === 0 ? 'Trip 0 · consolidated' : `Trip ${trip}`}<span className="ml-2 font-normal text-muted">{tripRows.length} {tripRows.length === 1 ? 'row' : 'rows'}</span></td>
                  <td className="px-3 py-1.5 text-right text-[12px] font-semibold tabular-nums text-ink-900">{formatINR(Math.round(subtotal * 100) / 100)}</td>
                  <td colSpan={onDelete ? 3 : 2} />
                </tr>
                {tripRows.map(({ expense: e, record, code }) => {
                  const bills = billState(e), rate = rateOf(e), active = e.id === selectedId
                  return (
                    <motion.tr key={e.id} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                      onClick={() => onSelect(e.id)} aria-selected={active} title={code}
                      className={cn('cursor-pointer border-t border-line/70 transition-colors', active ? 'bg-indigo-100/50' : 'hover:bg-panel/60')}>
                      <td className="px-3 py-2 font-mono text-[12px] text-muted">{record}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{sheetDate(e.date)}</td>
                      <td className="max-w-[260px] truncate px-3 py-2 font-medium text-ink-900">{e.particulars}</td>
                      <td className="px-3 py-2">{e.mode}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{e.kms ?? 'NA'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{rate == null ? '-' : formatINR(rate)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink-900">{formatINR(e.amount)}</td>
                      <td className="max-w-[200px] truncate px-3 py-2 text-muted">{e.remarks}</td>
                      <td className="px-3 py-2">
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                          bills === 'Yes' ? 'bg-emerald-100 text-emerald-800' : bills === 'No' ? 'bg-amber-100 text-amber-800' : 'bg-ink-900/[0.06] text-ink-700')}>
                          {e.attachments.length > 0 && <Icon name="Paperclip" size={11} />}{bills}{e.attachments.length > 1 ? ` ×${e.attachments.length}` : ''}
                        </span>
                      </td>
                      {onDelete && <td className="px-2 py-1 text-right">
                        <button type="button" aria-label={`Delete row ${code}`} title="Delete row" onClick={(ev) => { ev.stopPropagation(); onDelete(e.id) }}
                          className="grid h-7 w-7 place-items-center rounded-md text-muted opacity-60 transition hover:bg-crimson-100 hover:text-crimson hover:opacity-100 focus-visible:opacity-100">
                          <Icon name="Trash2" size={14} />
                        </button>
                      </td>}
                    </motion.tr>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
