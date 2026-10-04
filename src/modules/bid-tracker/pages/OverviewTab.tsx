import { BID_STAGE_MAP, BID_STAGE_REQUIREMENTS } from '@goms/domain'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useBidCorrigenda, useBidMutations, useFollowUpMutations, useFollowUps, useResolvedOwners, useSalesPersons } from '@/lib/api'
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
  const { data: followUps = [] } = useFollowUps('bid', bid.id)
  const { create: createFollowUp, setStatus, remove: removeFollowUp } = useFollowUpMutations()
  const [note, setNote] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const openFollowUps = followUps.filter((f) => f.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const runAction = async (action: () => Promise<unknown>) => {
    setActionError(null)
    try { await action(); return true } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not save the next action.'); return false }
  }
  const ownerPerson = owner ? people.find((p) => p.id === owner.salesPersonId) : undefined

  return (
    <div className="space-y-5 p-4">
      {requirements.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-ink" role="note">
          <strong>Stage exit criteria ({stage?.label}):</strong>
          <div className="mt-1">To move beyond this stage: {requirements.join('; ')}.</div>
          <p className="mt-1 text-[12px] text-muted">These criteria are guidance only; completion or submission is not verified here.</p>
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

      <div className="border-t border-line pt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Next Action</div>
        {openFollowUps.length === 0 && <div className="py-2 text-sm text-muted">No open next action.</div>}
        {openFollowUps.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>{f.note || 'Untitled action'} <span className="text-muted">— due {f.dueDate}</span></span>
            <span className="flex shrink-0 gap-2">
              <Button variant="secondary" size="sm" onClick={() => runAction(() => setStatus.mutateAsync({ id: f.id, status: 'done' }))}>Mark Done</Button>
              <Button variant="ghost" size="sm" onClick={() => runAction(() => removeFollowUp.mutateAsync(f.id))}>Delete</Button>
            </span>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <input
            placeholder="Next action…" value={note} onChange={(e) => setNote(e.target.value)}
            className="h-8 min-w-[16rem] flex-1 rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus-visible:focus-ring"
          />
          <label className="flex items-center gap-1 text-[13px] text-muted">
            Due Date
            <input
              type="date" aria-label="Due Date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              className="h-8 rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus-visible:focus-ring"
            />
          </label>
          <Button
            variant="primary" size="sm" disabled={!note.trim() || !dueDate || createFollowUp.isPending}
            onClick={async () => {
              const ok = await runAction(() => createFollowUp.mutateAsync({ entityType: 'bid', entityId: bid.id, note: note.trim(), dueDate }))
              if (ok) { setNote(''); setDueDate('') }
            }}
          >
            Add Next Action
          </Button>
        </div>
        {actionError && <div role="alert" className="pt-1 text-[12px] text-crimson">{actionError}</div>}
      </div>
    </div>
  )
}
