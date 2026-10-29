import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { billState, claimTotal, CLAIM_STATUSES, formatINR, monthLabel, orderedRows, sheetDate, statusLabel, type Claim, type ClaimStatus } from './model'
import { exportClaimsXlsx } from './exportFiles'

/** Every claim from the first month on: all rows in one list, filterable, exportable in the claim-sheet schema. */
export function MasterView({ claims, onOpen }: { claims: Claim[]; onOpen: (month: string, expenseId: string) => void }) {
  const [year, setYear] = useState('all')
  const [status, setStatus] = useState<ClaimStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const years = [...new Set(claims.map((c) => c.month.slice(0, 4)))].sort().reverse()
  const visible = useMemo(() => claims
    .filter((c) => c.expenses.length && (year === 'all' || c.month.startsWith(year)) && (status === 'all' || c.status === status))
    .sort((a, b) => b.month.localeCompare(a.month)), [claims, year, status])
  const q = query.trim().toLowerCase()
  const rows = visible.flatMap((claim) => orderedRows(claim)
    .filter(({ expense: e, code }) => !q || [e.particulars, e.remarks, e.project, e.mode, code].some((t) => t.toLowerCase().includes(q)))
    .map((row) => ({ ...row, claim })))
  const lifetime = visible.reduce((s, c) => s + claimTotal(c), 0)
  const credited = visible.filter((c) => c.status === 'credited' || c.status === 'closed').reduce((s, c) => s + claimTotal(c), 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[['Claimed', lifetime], ['Credited', credited], ['In progress', lifetime - credited]].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-white p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
            <p className="text-2xl font-semibold tabular-nums text-ink-900">{formatINR(Math.round(Number(value) * 100) / 100)}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search particulars, remarks, project, code…" className="pl-8" aria-label="Search all expenses" />
        </div>
        <select aria-label="Year" value={year} onChange={(e) => setYear(e.target.value)} className="h-10 rounded-lg border border-line bg-white px-2 text-sm">
          <option value="all">All years</option>{years.map((y) => <option key={y}>{y}</option>)}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus | 'all')} className="h-10 rounded-lg border border-line bg-white px-2 text-sm">
          <option value="all">Every status</option>{CLAIM_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <Button disabled={!visible.length} onClick={() => exportClaimsXlsx(visible, `Reimbursements-master-${year}.xlsx`)}><Icon name="Download" size={15} />Export ({visible.length} months)</Button>
      </div>
      {rows.length === 0 ? <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">No expenses match.</p> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead className="bg-panel/70 text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>{['Month', 'Code', 'Date', 'Particulars', 'Mode', 'Amount', 'Bills', 'Status'].map((h) => <th key={h} className={`px-3 py-2 font-medium ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(({ expense: e, code, claim }) => (
                <tr key={e.id} onClick={() => onOpen(claim.month, e.id)} className="cursor-pointer border-t border-line/70 hover:bg-panel/60">
                  <td className="whitespace-nowrap px-3 py-2">{monthLabel(claim.month, 'short')}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted">{code}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{sheetDate(e.date)}</td>
                  <td className="max-w-[280px] truncate px-3 py-2 font-medium text-ink-900">{e.particulars}</td>
                  <td className="px-3 py-2">{e.mode}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(e.amount)}</td>
                  <td className="px-3 py-2">{billState(e)}{e.attachments.length ? ` (${e.attachments.length})` : ''}</td>
                  <td className="px-3 py-2 text-muted">{statusLabel(claim.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
