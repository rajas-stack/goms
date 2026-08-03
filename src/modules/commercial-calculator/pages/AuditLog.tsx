import { useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Select } from '@/components/ui/Field'
import { useAuditLogs } from '../api'

const ENTITY_TYPES = [
  { value: '', label: 'All entity types' },
  { value: 'boq', label: 'BOQ' },
  { value: 'sku', label: 'SKU' },
]

/** Read-only, filterable view over the append-only Commercial Calculator
 *  audit trail (spec §6.6/§15) — BOQ creation and lifecycle transitions
 *  write here today. */
export function AuditLog() {
  const [entityType, setEntityType] = useState('')
  const { data: rows = [] } = useAuditLogs({ entityType: entityType || undefined })

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <Select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="w-56">
          {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <Icon name="FileText" size={20} className="text-muted" />
          <p className="text-sm text-muted">No audit entries yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-line bg-white px-3 py-2.5">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="rounded bg-panel px-1.5 py-0.5 text-[11px] font-mono uppercase text-ink-700">{row.entityType}</span>
                <span className="font-medium text-ink-900">{row.action}</span>
                <span className="text-muted">·</span>
                <span className="text-muted">{row.field}: {row.oldValue || '—'} → {row.newValue}</span>
              </div>
              {row.reason && <div className="mt-1 text-[12px] text-muted">{row.reason}</div>}
              <div className="mt-1 text-[11px] text-muted">{row.changedAt}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
