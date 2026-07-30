import { useState } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { WorkFormDialog } from './WorkFormDialog'
import { formatBudgetRange, formatWorkValue, workUnitLabel } from './department-meta'
import { stageLabel } from '@/data/pipeline-stages'
import { useOpportunityMutations, useResolvedOwners, useSalesPersons } from '@/lib/api'
import { useWorkspace } from '@/features/workspace/context'
import { OwnerBadge } from '@/features/sales/OwnerBadge'
import { AssignOwnerDialog } from '@/features/sales/AssignOwnerDialog'
import { isoToday } from '@/lib/dates'
import { SALES_TEAM } from '@/data/sales-team'
import type { Opportunity } from '@/lib/types'

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
  const { data: people = [] } = useSalesPersons()
  const oppIds = opportunities.map((w) => w.id)
  const { data: owners = {} } = useResolvedOwners('opportunity', oppIds, isoToday())
  const [openId, setOpenId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Opportunity | null>(null)
  const [assignFor, setAssignFor] = useState<Opportunity | null>(null)

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }
  function openEdit(w: Opportunity) {
    setEditing(w)
    setDialogOpen(true)
  }
  function save(draft: Omit<Opportunity, 'id' | 'departmentId' | 'stateCode' | 'createdAt' | 'createdBy'>) {
    if (editing) update.mutate({ id: editing.id, patch: draft })
    else create.mutate({ departmentId, ...draft })
  }
  function removeOpportunity(id: string) {
    remove.mutate(id)
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
                  onClick={() => setOpenId(expanded ? null : w.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(expanded ? null : w.id) }}
                  className="flex items-center gap-2 px-2.5 py-2 text-left"
                >
                  <motion.span animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.15 }} className="shrink-0 text-muted">
                    <Icon name="ChevronRight" size={14} />
                  </motion.span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">{w.opportunityName || 'Untitled opportunity'}</span>
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
                  <button
                    type="button"
                    aria-label="Edit opportunity"
                    onClick={(e) => { e.stopPropagation(); openEdit(w) }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-ink-900/[0.06] hover:text-ink"
                  >
                    <Icon name="Pencil" size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove opportunity"
                    onClick={(e) => { e.stopPropagation(); removeOpportunity(w.id) }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-crimson-100 hover:text-crimson"
                  >
                    <Icon name="Trash2" size={13} />
                  </button>
                </div>

                {expanded && (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line px-2.5 py-2.5 text-[13px]">
                    <Detail label="GEM / Tender ID" value={w.gemTenderId} />
                    <Detail label="Vertical" value={w.vertical} />
                    <Detail label="Published" value={w.publishDate} />
                    <Detail label="Submission" value={w.submissionDate} />
                    <Detail label="Component" value={w.component.join(', ')} />
                    <Detail label="Quantity" value={w.quantity} />
                    <Detail label="Sales person" value={SALES_TEAM.find((m) => m.email === w.salesPersonEmail)?.name ?? ''} />
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
                    <Button size="sm" onClick={() => setAssignFor(w)}>
                      {owners[w.id] ? 'Reassign' : 'Assign'}
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <Button size="sm" onClick={openCreate}><Icon name="Plus" size={14} /> Create Opportunity</Button>

      <WorkFormDialog
        open={dialogOpen}
        work={editing}
        draftKey={draftKeyPrefix ? `${draftKeyPrefix}:${editing?.id ?? 'new'}` : null}
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
