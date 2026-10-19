import { useMemo, useState } from 'react'
import { Combobox } from '@/components/ui/Combobox'
import { BID_IMPORT_KEEP_AS_HISTORY, bidTransferFields, resolveBidTransferField, type BidImportTable, type BidTransferContext } from '@goms/domain'

const AUTO = '#auto', SKIP = '#skip'

/** Import wizard step 2: every spreadsheet column with its suggested app field. The user can
 *  re-point a column to another existing field, keep it as history only, or skip it. Changing a
 *  choice re-validates the batch (BidImportDialog.remap); the server applies the same mapping. */
export function BidImportMapping({ table, customFields, disabled, onChange }: {
  table: BidImportTable
  customFields: BidTransferContext['customFields']
  disabled: boolean
  onChange: (mapping: (string | null)[]) => void
}) {
  const fields = useMemo(() => bidTransferFields({ existing: [], people: [], states: [], departments: [], customFields }), [customFields])
  const mapping = table.headers.map((_, c) => table.mapping?.[c] ?? null)
  const sample = (c: number) => String(table.rows.find(r => r[c] !== null && String(r[c]).trim())?.[c] ?? '')
  const set = (c: number, value: string) => onChange(mapping.map((m, i) => (i === c ? (value === AUTO ? null : value === SKIP ? '' : value) : m)))
  const [query, setQuery] = useState('')
  const counts = { mapped: 0, history: 0, skipped: 0 }
  const rows = table.headers.map((header, c) => {
    const choice = mapping[c], suggested = header.trim() ? resolveBidTransferField(header, fields) : undefined
    const target = choice === '' || choice === BID_IMPORT_KEEP_AS_HISTORY ? undefined : choice ? fields.find(f => f.id === choice) : suggested
    const status = choice === '' ? 'Skipped' : target ? (choice ? 'Your choice' : 'Matched') : 'History only'
    counts[choice === '' ? 'skipped' : target ? 'mapped' : 'history']++
    return { header, c, choice, suggested, status, target: target?.label ?? '' }
  })
  const q = query.trim().toLowerCase()
  const shown = q ? rows.filter(r => `${r.header} ${r.target} ${r.status}`.toLowerCase().includes(q)) : rows

  return (
    <details className="rounded-lg border border-line text-sm" open>
      <summary className="cursor-pointer p-3 font-medium">
        Map columns — {counts.mapped} to app fields · {counts.history} kept as history · {counts.skipped} skipped
      </summary>
      <div className="border-t border-line p-2">
        <input type="search" aria-label="Search columns and fields" placeholder="Search spreadsheet columns or GOMS fields…" value={query}
          onChange={e => setQuery(e.target.value)} className="w-full rounded-md border border-line bg-white px-2 py-1.5" />
      </div>
      <div className="max-h-72 overflow-auto border-t border-line">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-panel"><tr><th className="p-2">Spreadsheet column</th><th className="p-2">Sample value</th><th className="p-2">GOMS field</th><th className="p-2">Status</th></tr></thead>
          <tbody>
            {shown.map(({ header, c, choice, suggested, status }) => (
              <tr key={c} className="border-t border-line">
                <td className="p-2 font-medium">{header || `Column ${c + 1}`}</td>
                <td className="max-w-48 truncate p-2 text-muted" title={sample(c)}>{sample(c)}</td>
                <td className="p-2">
                  <Combobox aria-label={`GOMS field for ${header || `column ${c + 1}`}`} disabled={disabled} className="min-w-56"
                    value={choice === '' ? SKIP : choice ?? AUTO} onChange={value => { if (value) set(c, value) }}
                    options={[
                      { value: AUTO, label: suggested ? `Suggested: ${suggested.label}` : 'No match — keep as history' },
                      ...fields.map(f => ({ value: f.id, label: f.label, searchText: f.id })),
                      { value: BID_IMPORT_KEEP_AS_HISTORY, label: 'Keep as history only' },
                      { value: SKIP, label: 'Skip column' },
                    ]} />
                </td>
                <td className={`p-2 ${status === 'Skipped' ? 'text-red-800' : status === 'History only' ? 'text-amber-800' : 'text-emerald-800'}`}>{status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
