import type { BidImportMatch, BidRowAction } from '@goms/domain'

const ACTIONS: { value: BidRowAction; label: string; hint: string }[] = [
  { value: 'skip', label: 'Skip', hint: 'Ignore this row.' },
  { value: 'add', label: 'Add as duplicate', hint: 'Create a new record with a new Bid ID.' },
  { value: 'override', label: 'Override', hint: 'Update the existing record and keep its Bid ID. Only the changes listed are written; blank cells never clear a value.' },
]

/** Import wizard decision gate: every row matching an existing bid (or an earlier row) needs an explicit
 *  Skip / Add as duplicate / Override before the batch can be added. Nothing is overwritten automatically. */
export function BidImportMatches({ matches, actions, disabled, onChange }: {
  matches: BidImportMatch[]
  actions: Record<string, BidRowAction>
  disabled: boolean
  onChange: (actions: Record<string, BidRowAction>) => void
}) {
  if (!matches.length) return null
  const pending = matches.filter(m => !actions[String(m.row)]).length
  const setAll = (action: BidRowAction) => onChange(Object.fromEntries(matches.map(m => [String(m.row), action === 'override' && !m.existingId ? 'skip' : action])))
  return (
    <section aria-label="Existing bid matches" className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{matches.length} rows match existing bids — {pending ? `${pending} need a decision` : 'all decided'}</strong>
        <div className="flex gap-1">
          {ACTIONS.map(a => <button key={a.value} type="button" disabled={disabled} onClick={() => setAll(a.value)} className="rounded-md border border-line bg-white px-2 py-1 text-xs hover:bg-ink-900/[0.04]">{a.label} all</button>)}
        </div>
      </div>
      <ul className="mt-2 max-h-80 space-y-2 overflow-auto">
        {matches.map(m => {
          const action = actions[String(m.row)]
          return (
            <li key={m.row} className="rounded-md border border-line bg-white p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>Row {m.row} matches <strong>{m.existingName}</strong>{m.existingCode ? ` (${m.existingCode})` : ''}</span>
                <div role="radiogroup" aria-label={`Decision for row ${m.row}`} className="flex gap-1">
                  {ACTIONS.filter(a => a.value !== 'override' || m.existingId).map(a => (
                    <label key={a.value} title={a.hint} className={`cursor-pointer rounded-md border px-2 py-1 text-xs ${action === a.value ? 'border-ink-900 bg-ink-900 text-white' : 'border-line hover:bg-ink-900/[0.04]'}`}>
                      <input type="radio" className="sr-only" name={`match-${m.row}`} disabled={disabled} checked={action === a.value} onChange={() => onChange({ ...actions, [String(m.row)]: a.value })} />
                      {a.label}
                    </label>
                  ))}
                </div>
              </div>
              {m.existingId && (
                <details className="mt-1 text-xs" open={action === 'override'}>
                  <summary className="cursor-pointer text-muted">{m.diffs.length ? `${m.diffs.length} fields would change on Override` : 'No field differences'}</summary>
                  {m.diffs.length > 0 && (
                    <table className="mt-1 w-full text-left">
                      <thead><tr className="text-muted"><th className="p-1">Field</th><th className="p-1">Current</th><th className="p-1">From file</th></tr></thead>
                      <tbody>{m.diffs.map(d => (
                        <tr key={d.field} className="border-t border-line align-top">
                          <td className="p-1 font-medium">{d.label}</td>
                          <td className="max-w-64 break-words p-1 text-red-800 line-through decoration-red-300">{d.before || '—'}</td>
                          <td className="max-w-64 break-words p-1 text-emerald-800">{d.after}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  )}
                </details>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
