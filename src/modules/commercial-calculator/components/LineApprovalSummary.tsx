import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { resolveApprovalBand } from '../repository-logic'
import { formatPercent } from '../format'
import type { ApprovalMatrixRule, CommercialBoqLineItem } from '../types'
import type { Employee } from '@/lib/types'

/** Explains, in plain language, whether this line's CURRENT discount needs
 *  approval and why — reuses the same `resolveApprovalBand` the document-
 *  level Approval Summary and the actual approve/reject gate already use, so
 *  this can never disagree with them. When `employees`/`onDecide` are both
 *  supplied and the line is still `pending`, also renders the
 *  approver/remarks/Approve/Reject controls that used to live in the
 *  removed `ApprovalsTab` — same `decideLine` handler, new location (BOQ
 *  editable-workspace overhaul spec §6). */
/** The minimal line shape this needs — narrower than the full
 *  `CommercialBoqLineItem` so a not-yet-saved `CreateBoq.tsx` draft line
 *  (no `boqId`/`taxPct`/`lineTotal` yet) can preview the same approval-band
 *  explanation a saved line gets, via this exact component rather than a
 *  second one. A real `CommercialBoqLineItem` already satisfies this
 *  structurally. */
export type ApprovalSummaryLine = Pick<CommercialBoqLineItem, 'id' | 'discountPct' | 'approvalStatus' | 'approvalDate' | 'approvalRemarks'>

export function LineApprovalSummary({ line, approvalMatrix, employees, onDecide }: {
  line: ApprovalSummaryLine
  approvalMatrix: ApprovalMatrixRule[]
  employees?: Employee[]
  onDecide?: (lineId: string, decision: 'approved' | 'rejected', approverId: string, remarks: string) => void
}) {
  const band = resolveApprovalBand(approvalMatrix, line.discountPct)
  const bandLabel = band.approvalLevelLabel || band.name
  const [approverId, setApproverId] = useState('')
  const [remarks, setRemarks] = useState('')
  const canDecide = approverId.length > 0
  const showDecisionControls = line.approvalStatus === 'pending' && !!employees && !!onDecide

  return (
    <div className="mt-2 rounded-lg border border-line bg-panel/40 px-3 py-2 text-[12px]">
      {line.approvalStatus === 'approved' || line.approvalStatus === 'rejected' ? (
        <p className={line.approvalStatus === 'approved' ? 'text-emerald-700' : 'text-rose-700'}>
          {line.approvalStatus === 'approved' ? 'Approved' : 'Rejected'}
          {line.approvalDate ? ` on ${line.approvalDate}` : ''}
          {line.approvalRemarks ? ` — "${line.approvalRemarks}"` : ''}
        </p>
      ) : band.allowAutoApproval ? (
        <p className="text-emerald-700">
          No approval required — this line's discount of {formatPercent(line.discountPct)} is within the auto-approval band (≤ {band.maxDiscountPct}%).
        </p>
      ) : (
        <p className="text-amber-800">
          Approval required — this line's discount of {formatPercent(line.discountPct)} falls in the {bandLabel} band (needs approval at {band.minDiscountPct}% and above).
        </p>
      )}
      {showDecisionControls && (
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Approver">
            <Select value={approverId} onChange={(e) => setApproverId(e.target.value)}>
              <option value="">Select…</option>
              {employees!.map((emp) => <option key={emp.id} value={emp.id}>{emp.name} — {emp.designation}</option>)}
            </Select>
          </Field>
          <Field label="Remarks">
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          <div className="flex items-end gap-2">
            <Button size="sm" variant="primary" disabled={!canDecide} onClick={() => onDecide!(line.id, 'approved', approverId, remarks)}>
              Approve
            </Button>
            <Button size="sm" disabled={!canDecide} onClick={() => onDecide!(line.id, 'rejected', approverId, remarks)}>
              Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
