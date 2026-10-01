// Generic current-vs-proposed review UI (design spec §12) — one checkbox per
// row, an explicit "Save N Changes" commit, and a "Keep Existing Values"
// reset. Used today by Bid Tracker's corrigendum review; the existing
// SessionImportWizard diff table is a candidate to adopt it later (not done
// in this pass — see Task 34's scope note).
import { useState } from 'react'
import { Button } from './ui/Button'
import { Checkbox } from './ui/Checkbox'

export interface FieldDiffRow {
  id: string
  label: string
  currentValue: string
  proposedValue: string
  /** A row already decided elsewhere: shown with this text, not re-decidable. */
  decided?: string
}

export function FieldDiffReviewTable({ rows, onAccept, onReject }: {
  rows: FieldDiffRow[]
  onAccept: (id: string) => void | Promise<unknown>
  onReject: (id: string, reason?: string) => void | Promise<unknown>
}) {
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = rows.filter((r) => !r.decided)

  function toggle(id: string) {
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Sequential, stopping at the first failure: a rejected accept (e.g. a
  // frozen field) must surface, not be skipped while later rows are applied.
  async function save() {
    setSaving(true)
    setError(null)
    try {
      for (const row of open) {
        if (accepted.has(row.id)) await onAccept(row.id)
        else await onReject(row.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the review.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-4 border-b border-line py-3" data-testid="diff-row">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{row.label}</div>
            <div className="text-[11px] text-muted">CURRENT VALUE</div>
            <div className="text-sm text-ink">{row.currentValue || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">→ PROPOSED AMENDMENT</div>
            <div className="text-sm text-ink">{row.proposedValue || '—'}</div>
          </div>
          {row.decided
            ? <span className="text-[12px] font-medium capitalize text-muted">{row.decided}</span>
            : <Checkbox aria-label="Accept Change" checked={accepted.has(row.id)} onChange={() => toggle(row.id)} />}
        </div>
      ))}
      {error && <p role="alert" className="pt-2 text-[13px] text-crimson">{error}</p>}
      <div className="flex justify-between pt-3">
        <Button variant="ghost" size="sm" disabled={saving} onClick={() => setAccepted(new Set())}>Keep Existing Values</Button>
        <Button variant="primary" disabled={saving || open.length === 0} onClick={() => void save()}>
          Save {accepted.size} Change{accepted.size === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  )
}
