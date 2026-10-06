import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import { formatPercent, isNegativeMargin } from '../format'

/** The section-jump nav shared by `CreateBoq.tsx` and `ProposalDetail.tsx` —
 *  one implementation so a user learns the BOQ workspace's navigation once
 *  and it stays identical whether creating or editing a draft (BOQ workbench
 *  QA pass §3). */
export const BOQ_WORKSPACE_SECTIONS = [
  { id: 'section-details', label: 'BOQ Details' },
  { id: 'section-lines', label: 'Line Items' },
  { id: 'section-preview', label: 'Preview' },
] as const

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
  /** `null` = the SKUs' costs are hidden from this role (RBAC): shown as "Restricted". */
  marginPct: number | null
  grandTotal: number
  currencyCode: string
  onPreview: () => void
  saveDraft?: { onClick: () => void; label: string; disabled?: boolean }
  submit?: { onClick: () => void; label: string; disabled?: boolean }
}) {
  return (
    // No sticky positioning of its own — the caller wraps this together with
    // whatever sticky bar follows it (e.g. the section-jump nav) in a single
    // `sticky top-0` container, so the two never both pin to the same
    // coordinate and fight over it (a `position: sticky` element ignores its
    // sibling's height; two independent `top-0` bars land on top of each
    // other once both are stuck, silently swallowing clicks on whichever one
    // has the lower z-index).
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-white/95 px-4 py-1.5 text-[12px] backdrop-blur">
      <span className="font-semibold text-ink-900">{boqNumber ?? 'New BOQ'}</span>
      <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] font-medium text-ink-700">{statusLabel}</span>
      {customerName
        ? <PersonName person={{ name: customerName }} className="text-muted" />
        : <span className="text-muted">—</span>}
      <span className="text-muted">Lines <span className="font-medium text-ink-900">{lineCount}</span></span>
      <span className="text-muted">
        Margin{' '}
        <span className={marginPct !== null && isNegativeMargin(marginPct) ? 'font-medium text-rose-700' : 'font-medium text-ink-900'}>
          {marginPct === null ? 'Restricted' : `${formatPercent(marginPct)}${isNegativeMargin(marginPct) ? ' — Below Cost' : ''}`}
        </span>
      </span>
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
