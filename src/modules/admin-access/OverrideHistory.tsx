import type { OverrideHistoryFilter, OverrideHistoryRow } from '@/data/accessTypes'
import { useOverrideHistory } from './api'
import { errorMessage, formatWhen, roleLabel } from './format'

const ACTION_LABEL: Record<string, string> = { create: 'Created', update: 'Changed', remove: 'Removed' }
const value = (v: string) => v || '—'

/** One line saying what changed: `effect: grant → revoke`, `reason: old → new`. */
const changeText = (row: OverrideHistoryRow) => `${row.field}: ${value(row.oldValue)} → ${value(row.newValue)}`

/** The audit trail of override changes (who, when, what, why), newest first, exactly as the server returned it. With a filter it
 *  is one person's history and the person column is left out. */
export function OverrideHistory(filter: OverrideHistoryFilter) {
  const { data, isLoading, error } = useOverrideHistory(filter)
  const showPerson = !filter.email

  if (isLoading) return <p className="text-sm text-muted">Loading history…</p>
  if (error) return <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{errorMessage(error, 'Could not load the override history.')}</p>
  if (!data || data.length === 0) return <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">No override changes have been recorded yet.</p>

  return (
    <div className="max-h-96 overflow-auto rounded-xl border border-line">
      <table aria-label="Override history" className="w-full min-w-[720px] text-left text-[12px]">
        <thead className="sticky top-0 bg-panel text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-3 py-2">When</th>
            <th scope="col" className="px-3 py-2">Who</th>
            <th scope="col" className="px-3 py-2">Action</th>
            {showPerson && <th scope="col" className="px-3 py-2">Person</th>}
            <th scope="col" className="px-3 py-2">Change</th>
            <th scope="col" className="px-3 py-2">Reason</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} className="border-t border-line/70 align-top">
              <td className="whitespace-nowrap px-3 py-1.5">{formatWhen(row.changedAt)}</td>
              <td className="px-3 py-1.5">{row.changedBy || '—'}</td>
              <td className="px-3 py-1.5">{ACTION_LABEL[row.action] ?? row.action}</td>
              {showPerson && (
                <td className="px-3 py-1.5">
                  <span className="block">{row.email}</span>
                  <span className="block text-muted">{roleLabel(row.role)}</span>
                </td>
              )}
              <td className="px-3 py-1.5">{changeText(row)}</td>
              <td className="px-3 py-1.5 text-muted">{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
