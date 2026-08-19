import { resolveApprovalBand } from '../repository-logic'
import type { ApprovalMatrixRule, CommercialBoqLineItem } from '../types'

/** Explains, in plain language, whether this line's CURRENT discount needs
 *  approval and why — reuses the same `resolveApprovalBand` the document-
 *  level Approval Summary and the actual approve/reject gate already use, so
 *  this can never disagree with them (spec §5). */
export function LineApprovalSummary({ line, approvalMatrix }: { line: CommercialBoqLineItem; approvalMatrix: ApprovalMatrixRule[] }) {
  const band = resolveApprovalBand(approvalMatrix, line.discountPct)
  const bandLabel = band.approvalLevelLabel || band.name

  return (
    <div className="mt-2 rounded-lg border border-line bg-panel/40 px-3 py-2 text-[12px]">
      {band.allowAutoApproval ? (
        <p className="text-emerald-700">
          No approval required — this line's discount of {line.discountPct.toFixed(1)}% is within the auto-approval band (≤ {band.maxDiscountPct}%).
        </p>
      ) : (
        <p className="text-amber-800">
          Approval required — this line's discount of {line.discountPct.toFixed(1)}% falls in the {bandLabel} band (needs approval at {band.minDiscountPct}% and above).
        </p>
      )}
      {(line.approvalStatus === 'approved' || line.approvalStatus === 'rejected') && (
        <p className="mt-1 text-ink-700">
          {line.approvalStatus === 'approved' ? 'Approved' : 'Rejected'}
          {line.approvalDate ? ` on ${line.approvalDate}` : ''}
          {line.approvalRemarks ? ` — "${line.approvalRemarks}"` : ''}
        </p>
      )}
    </div>
  )
}
