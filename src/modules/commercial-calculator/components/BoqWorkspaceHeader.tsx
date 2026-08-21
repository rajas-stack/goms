import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'

/** Sticky identity + live totals + primary actions bar (BOQ workbench spec
 *  §2) — a single compact row above the existing sticky section-jump nav,
 *  shared by `CreateBoq.tsx` (pre-save, `boqNumber: null`) and
 *  `ProposalDetail.tsx`. Purely presentational: every value and handler is
 *  supplied by the caller, which already computes/owns all of it. Omitting
 *  `saveDraft`/`submit` hides that button entirely — used for a non-draft
 *  BOQ, which shows only Preview. */
export function BoqWorkspaceHeader({
  boqNumber, statusLabel, customerName, lineCount, marginPct, grandTotal, currencyCode,
  onPreview, saveDraft, submit,
}: {
  boqNumber: string | null
  statusLabel: string
  customerName: string
  lineCount: number
  marginPct: number
  grandTotal: number
  currencyCode: string
  onPreview: () => void
  saveDraft?: { onClick: () => void; label: string; disabled?: boolean }
  submit?: { onClick: () => void; label: string; disabled?: boolean }
}) {
  return (
    <div className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-white/95 px-4 py-1.5 text-[12px] backdrop-blur">
      <span className="font-semibold text-ink-900">{boqNumber ?? 'New BOQ'}</span>
      <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] font-medium text-ink-700">{statusLabel}</span>
      <span className="truncate text-muted">{customerName || '—'}</span>
      <span className="text-muted">Lines <span className="font-medium text-ink-900">{lineCount}</span></span>
      <span className="text-muted">Margin <span className="font-medium text-ink-900">{marginPct.toFixed(1)}%</span></span>
      <span className="text-muted">
        Grand Total <span className="font-medium text-ink-900">{currencyCode} {grandTotal.toLocaleString()}</span>
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" onClick={onPreview}><Icon name="Eye" size={13} />Preview</Button>
        {saveDraft && (
          <Button size="sm" onClick={saveDraft.onClick} disabled={saveDraft.disabled}>{saveDraft.label}</Button>
        )}
        {submit && (
          <Button size="sm" variant="primary" onClick={submit.onClick} disabled={submit.disabled}>{submit.label}</Button>
        )}
      </div>
    </div>
  )
}
