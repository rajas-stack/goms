import { BID_STAGE_MAP, BID_STAGE_REQUIREMENTS } from '@goms/domain'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useBidCorrigenda, useBidMutations, useResolvedOwners, useSalesPersons } from '@/lib/api'
import { isoToday } from '@/lib/dates'
import type { Bid, BidMilestone } from '@/lib/types'

const DATA_CONFIDENCE_LABEL: Record<Bid['dataConfidence'], string> = { verified: 'Verified', needs_review: 'Needs Review' }

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{children}</div>
    </div>
  )
}

/** Overview tab: where the bid is, what the next stage needs, the earliest open
 *  milestone, and who owns it. The owner comes from the shared ownership
 *  resolution (direct vs inherited is shown, never flattened) — no second
 *  ownership lookup exists for bids. */
export function OverviewTab({ bid, milestones }: { bid: Bid; milestones: BidMilestone[] }) {
  const requirements = BID_STAGE_REQUIREMENTS[bid.stageKey] ?? []
  const stage = BID_STAGE_MAP[bid.stageKey]
  const nextMilestone = milestones
    .filter((m) => m.status === 'open' && m.dueAt)
    .sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1))[0]

  const { data: owners } = useResolvedOwners('bid', [bid.id], isoToday())
  const { data: people = [] } = useSalesPersons()
  const owner = owners?.[bid.id]
  const { markVerified } = useBidMutations()
  const { data: corrigenda = [] } = useBidCorrigenda(bid.id)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  // Mirrors the server gate (bids.markVerified): an undecided corrigendum is what
  // flagged the bid, so the button does not invite a click that would be refused.
  const hasPendingCorrigendum = corrigenda.some((c) => c.status === 'pending_review')
  const verify = async () => {
    setVerifyError(null)
    try { await markVerified.mutateAsync(bid.id) } catch (e) { setVerifyError(e instanceof Error ? e.message : 'Could not mark verified.') }
  }
  const ownerPerson = owner ? people.find((p) => p.id === owner.salesPersonId) : undefined

  return (
    <div className="space-y-5 p-4">
      {requirements.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-ink" role="note">
          <strong>Next Stage Requirements ({stage?.label}):</strong>
          <div>Recommended inputs needed: {requirements.join(', ')}.</div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Stage">{stage?.label ?? bid.stageKey}</Stat>
        <Stat label="Decision"><span className="capitalize">{bid.decision.replace('_', ' ')}</span></Stat>
        <Stat label="Data Confidence">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={bid.dataConfidence === 'verified' ? 'emerald' : 'amber'}>{DATA_CONFIDENCE_LABEL[bid.dataConfidence]}</Badge>
            {bid.dataConfidence === 'needs_review' && (
              <Button variant="secondary" size="sm" disabled={hasPendingCorrigendum || markVerified.isPending} onClick={verify}>Mark Verified</Button>
            )}
          </div>
          {bid.dataConfidence === 'needs_review' && hasPendingCorrigendum && (
            <div className="mt-1 text-[12px] text-muted">Resolve the pending corrigendum change before marking verified.</div>
          )}
          {verifyError && <div role="alert" className="mt-1 text-[12px] text-crimson">{verifyError}</div>}
        </Stat>
        <Stat label="Bid Owner">
          {ownerPerson ? (
            <>
              {ownerPerson.name}
              {owner?.source === 'inherited' && <span className="ml-1 text-[12px] text-muted">(inherited)</span>}
            </>
          ) : <span className="text-muted">Unassigned</span>}
        </Stat>
        <Stat label="Earliest Next Milestone">
          {nextMilestone ? `${nextMilestone.label} — ${nextMilestone.dueAt!.slice(0, 10)}` : 'None scheduled'}
        </Stat>
        <Stat label="Tender Link">
          {bid.tenderLink
            ? <a href={bid.tenderLink} target="_blank" rel="noreferrer" className="underline">Open tender</a>
            : <span className="text-muted">—</span>}
        </Stat>
      </div>
    </div>
  )
}
