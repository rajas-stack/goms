import { useAllowed, usePermissions } from '@/lib/permissions'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Icon } from '@/components/ui/Icon'
import { WorkFormDialog } from './WorkFormDialog'
import { formatBudgetRange, formatWorkValue, workUnitLabel } from './department-meta'
import { stageLabel } from '@/data/pipeline-stages'
import { useBidForOpportunity, useBidMutations, useOpportunityMutations, useOwnershipMutations, useResolvedOwners, useSalesPersons } from '@/lib/api'
import { useWorkspace } from '@/features/workspace/context'
import { OwnerBadge } from '@/features/sales/OwnerBadge'
import { AssignOwnerDialog } from '@/features/sales/AssignOwnerDialog'
import { assignOwnerFromEmail } from '@/lib/assignOwnerFromEmail'
import { isoToday } from '@/lib/dates'
import type { Opportunity } from '@/lib/types'
import { isBidTrackerEnabled } from '@/modules/bid-tracker/enabled'

/** Starts a bid for an opportunity that has none, then opens it. An icon button like
 *  its neighbours (Edit/Remove): the details panel is narrow, and a text button here
 *  overflowed the row and pushed those icons off the edge. A failed create (including a
 *  duplicate from a concurrent tab) reports the server message via `onError`. */
function CreateBidButton({ opportunityId, onError }: { opportunityId: string; onError: (message: string | null) => void }) {
  const { data: bid, isLoading } = useBidForOpportunity(opportunityId)
  const { create } = useBidMutations()
  const navigate = useNavigate()
  const allowed = useAllowed('opp.bidTracker', 'create')
  if (isLoading || bid || !allowed) return null

  async function handleCreate(e: React.MouseEvent) {
    e.stopPropagation()
    onError(null)
    try {
      const created = await create.mutateAsync({ opportunityId })
      navigate(`/bid-tracker/bid/${created.id}`)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create the bid.')
    }
  }

  return (
    <button
      type="button" aria-label="Create Bid" title="Create Bid in Bid Tracker" disabled={create.isPending}
      onClick={handleCreate}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-ink-900/[0.06] hover:text-ink disabled:opacity-50"
    >
      <Icon name="Flag" size={13} />
    </button>
  )
}

/** A department's opportunity pipeline, shown as collapsible cards plus the
 *  "Create Opportunity" button that opens WorkFormDialog. Opportunities are
 *  repository records — this component owns their mutations directly rather
 *  than handing an array back to a parent, since there is no longer a
 *  serialized blob for the parent to write. */
export function WorksEditor({ departmentId, opportunities, draftKeyPrefix }: {
  departmentId: string
  opportunities: Opportunity[]
  draftKeyPrefix?: string
}) {
  const ws = useWorkspace()
  const { create, update, remove } = useOpportunityMutations()
  const { assign } = useOwnershipMutations()
  const perms = usePermissions()
  // Opportunities from Account Mapping are authorised as Bid Tracker rows; the server decides per row.
  const canEditWork = perms.mayWrite('opp.bidTracker')
  const canCreateWork = perms.can('opp.bidTracker', 'create')
  const canDeleteWork = perms.can('opp.bidTracker', 'delete')
  const canAssign = perms.mayWrite('am.ownership')
  const { data: people = [] } = useSalesPersons()
  const oppIds = opportunities.map((w) => w.id)
  const { data: owners = {} } = useResolvedOwners('opportunity', oppIds, isoToday())
  const [openId, setOpenId] = useState<string | null>(null)
  const [createBidError, setCreateBidError] = useState<{ id: string; message: string } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Opportunity | null>(null)
  const [assignFor, setAssignFor] = useState<Opportunity | null>(null)
  const [removing, setRemoving] = useState<Opportunity | null>(null)
  // One lookup, for the opportunity being edited — not one per card, and not the
  // whole Bid Tracker grid. Once a bid exists, stage and submission date belong
  // to it: the dialog locks them and save() leaves them out of the patch.
  const { data: editingBid } = useBidForOpportunity(editing?.id ?? null)
  const managedInBidTracker = !!editingBid

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }
  function openEdit(w: Opportunity) {
    setEditing(w)
    setDialogOpen(true)
  }
  // Item 10: saving Edit Opportunity with a newly-picked Sales Person must
  // also reflect into the real ownership ledger (`ownership_assignments`) —
  // otherwise the card's "Unassigned" badge keeps reading a stale resolution
  // even though `salesPersonEmail` itself saved fine. Reuses `owners` (the
  // same `useResolvedOwners('opportunity', oppIds, ...)` already fetched
  // above for every card in this list — `editing` is always one of
  // `opportunities`, so `owners[editing.id]` is already the right
  // resolution) rather than firing a second, redundant query for just this
  // one id. Per the same ruling as the Employee form: only an existing
  // `direct` resolution counts as "already owned" — an `inherited` one must
  // not suppress a genuine new direct assignment.
  async function save(draft: Omit<Opportunity, 'id' | 'opportunityCode' | 'departmentId' | 'stateCode' | 'createdAt' | 'createdBy'>) {
    if (editing) {
      // The API rejects ANY stageKey/submissionDate in the patch for an opportunity
      // with a bid — even an unchanged one — so they must not be sent at all.
      const { stageKey: _stage, submissionDate: _submission, closedOn: _closed, ...rest } = draft
      await update.mutateAsync({ id: editing.id, patch: managedInBidTracker ? rest : draft })
      const currentResolution = owners[editing.id]
      const currentOwnerSalesPersonId = currentResolution?.source === 'direct' ? currentResolution.salesPersonId : undefined
      await assignOwnerFromEmail({
        entityType: 'opportunity',
        entityId: editing.id,
        email: draft.salesPersonEmail,
        salesPersons: people,
        currentOwnerSalesPersonId,
        assignMutateAsync: assign.mutateAsync,
      })
    } else {
      create.mutate({ departmentId, ...draft })
    }
  }

  return (
    <div className="space-y-3">
      {opportunities.length === 0 ? (
        <p className="text-sm text-muted">No opportunities added yet.</p>
      ) : (
        <div className="space-y-2">
          {opportunities.map((w) => {
            const expanded = openId === w.id
            const valueLabel = formatWorkValue(w)
            return (
              <div key={w.id} className="rounded-lg border border-line bg-white">
                <div
                  role="button"
                  tabIndex={0}
                  data-testid={`opportunity-row-${w.id}`}
                  onClick={() => setOpenId(expanded ? null : w.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(expanded ? null : w.id) }}
                  className="flex items-center gap-2 px-2.5 py-2 text-left"
                >
                  <motion.span animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.15 }} className="shrink-0 text-muted">
                    <Icon name="ChevronRight" size={14} />
                  </motion.span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">{w.opportunityName || 'Untitled opportunity'}</span>
                  {w.opportunityCode && (
                    <span title="Opportunity ID" className="hidden shrink-0 truncate font-mono text-[11px] text-muted sm:inline">{w.opportunityCode}</span>
                  )}
                  <span className="shrink-0 rounded-full bg-panel px-2 py-0.5 text-[11px] font-medium text-ink-700">
                    {stageLabel(w.stageKey)}
                  </span>
                  {valueLabel && <span className="shrink-0 font-mono text-[12px] text-ink-700">{valueLabel}</span>}
                  {/* Clicking the owner opens their profile rather than toggling
                      this row's expand/collapse. */}
                  {owners[w.id] ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); ws.select('salesPerson', owners[w.id].salesPersonId) }}
                      className="shrink-0"
                    >
                      <OwnerBadge owner={owners[w.id]} people={people} className="cursor-pointer" />
                    </button>
                  ) : (
                    <span className="shrink-0">
                      <OwnerBadge owner={owners[w.id]} people={people} />
                    </span>
                  )}
                  {isBidTrackerEnabled() && <CreateBidButton opportunityId={w.id} onError={(message) => setCreateBidError(message ? { id: w.id, message } : null)} />}
                  {canEditWork && <button
                    type="button"
                    aria-label="Edit opportunity"
                    onClick={(e) => { e.stopPropagation(); openEdit(w) }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-ink-900/[0.06] hover:text-ink"
                  >
                    <Icon name="Pencil" size={13} />
                  </button>}
                  {canDeleteWork && <button
                    type="button"
                    aria-label="Remove opportunity"
                    onClick={(e) => { e.stopPropagation(); setRemoving(w) }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-crimson-100 hover:text-crimson"
                  >
                    <Icon name="Trash2" size={13} />
                  </button>}
                </div>

                {createBidError?.id === w.id && <p role="alert" className="border-t border-line px-2.5 py-1.5 text-[12px] text-crimson">{createBidError.message}</p>}
                {expanded && (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line px-2.5 py-2.5 text-[13px]">
                    <Detail label="GEM / Tender ID" value={w.gemTenderId} />
                    <Detail label="Vertical" value={w.vertical} />
                    <Detail label="Published" value={w.publishDate} />
                    <Detail label="Submission" value={w.submissionDate} />
                    <Detail label="Component" value={w.component.join(', ')} />
                    <Detail label="Quantity" value={w.quantity} />
                    <Detail label="Sales person" value={people.find((p) => p.officialEmail === w.salesPersonEmail)?.name ?? ''} />
                    <Detail label="Value" value={valueLabel} />
                    <Detail label="Budget confirmed" value={w.budgetKnown === 'yes' ? 'Yes' : w.budgetKnown === 'no' ? 'No' : ''} />
                    {w.budgetKnown === 'no' && (
                      <>
                        <Detail label="EMD amount" value={w.emdAmount ? `${w.emdAmount} ${workUnitLabel(w.emdUnit)}` : ''} />
                        <Detail label="Budget (derived)" value={formatBudgetRange(w)} />
                      </>
                    )}
                  </dl>
                )}
                {expanded && (
                  <div className="border-t border-line px-2.5 py-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-muted">AMNEX ownership</span>
                    {canAssign && (
                      <Button size="sm" onClick={() => setAssignFor(w)}>
                        {owners[w.id] ? 'Reassign' : 'Assign'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {canCreateWork && <Button size="sm" onClick={openCreate}><Icon name="Plus" size={14} /> Create Opportunity</Button>}

      <WorkFormDialog
        open={dialogOpen}
        work={editing}
        departmentId={departmentId}
        draftKey={draftKeyPrefix ? `${draftKeyPrefix}:${editing?.id ?? 'new'}` : null}
        managedInBidTracker={managedInBidTracker}
        onClose={() => setDialogOpen(false)}
        onSave={save}
      />

      {assignFor && (
        <AssignOwnerDialog
          open={!!assignFor}
          entityType="opportunity"
          entityId={assignFor.id}
          entityLabel={assignFor.opportunityName || 'Untitled opportunity'}
          onClose={() => setAssignFor(null)}
        />
      )}

      <ConfirmDeleteDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        itemLabel={removing?.opportunityName || 'this opportunity'}
        onConfirm={async () => {
          if (!removing) return
          await remove.mutateAsync(removing.id)
        }}
      />
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink-900">{value}</dd>
    </div>
  )
}
