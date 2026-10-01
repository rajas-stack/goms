import { Dialog } from '@/components/ui/Dialog'
import { FieldDiffReviewTable } from '@/components/FieldDiffReviewTable'
import { useBidCorrigenda, useBidCorrigendaMutations } from '@/lib/api'

const FIELD_LABEL: Record<string, string> = { submissionDeadline: 'Submission Deadline', tenderLink: 'Tender Link' }
const DECISION_LABEL = { accepted: 'Accepted', rejected: 'Kept existing', pending: '' } as const

/** ISO instants read as dates; everything else (links, free text) is shown as-is. */
const formatValue = (v: string) => (/^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toLocaleString() : v)

/** Explicit accept/reject review of one corrigendum's detected changes (spec
 *  §12). Nothing is applied until "Save": ticked rows are accepted, the rest
 *  keep their existing value. A frozen field rejects the accept and the
 *  message is shown inline — it is never overridden. */
export function CorrigendumReviewDialog({ open = true, bidId, corrigendumId, onClose }: {
  open?: boolean; bidId: string; corrigendumId: string; onClose: () => void
}) {
  const { data: corrigenda = [] } = useBidCorrigenda(bidId)
  const { reviewChange } = useBidCorrigendaMutations(bidId)
  const corrigendum = corrigenda.find((c) => c.id === corrigendumId)
  if (!corrigendum) return null

  return (
    <Dialog
      open={open} onClose={onClose} size="lg"
      title={`Review Corrigendum ${corrigendum.corrigendumNumber} Changes`}
      description="Confirmed deadlines are never replaced automatically. Approve the detected changes to apply; the rest keep their existing value."
    >
      <FieldDiffReviewTable
        rows={corrigendum.changes.map((c) => ({
          id: c.id, label: FIELD_LABEL[c.fieldKey] ?? c.fieldKey,
          currentValue: formatValue(c.currentValue), proposedValue: formatValue(c.proposedValue),
          decided: c.decision === 'pending' ? undefined : DECISION_LABEL[c.decision],
        }))}
        onAccept={(id) => reviewChange.mutateAsync({ changeId: id, decision: 'accepted' })}
        onReject={(id, reason) => reviewChange.mutateAsync({ changeId: id, decision: 'rejected', reason })}
      />
    </Dialog>
  )
}
