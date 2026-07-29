import { useState } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { WorkFormDialog } from './WorkFormDialog'
import { formatBudgetRange, formatWorkValue, workUnitLabel } from './department-meta'
import { SALES_TEAM } from '@/data/sales-team'
import type { DepartmentWork } from '@/lib/types'

/** A department's opportunity pipeline, shown as collapsible cards (each
 *  collapsed to its name + value, expandable for the rest — the same
 *  expand/collapse affordance as a branch card, sized for a narrow sidebar
 *  instead of a wide multi-column table) plus the "Create Opportunity"
 *  button that opens WorkFormDialog. Rendered read/manage-style wherever a
 *  department's Works are shown (DepartmentSection) — never as part of the
 *  add/edit department form. */
export function WorksEditor({ works, onChange, draftKeyPrefix }: {
  works: DepartmentWork[]
  onChange: (works: DepartmentWork[]) => void
  /** Identifies the owning department for draft persistence — e.g.
   *  `work:${node.id}`. Omit to disable drafting (no stable id available). */
  draftKeyPrefix?: string
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<DepartmentWork | null>(null)

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }
  function openEdit(w: DepartmentWork) {
    setEditing(w)
    setDialogOpen(true)
  }
  function save(work: DepartmentWork) {
    const exists = works.some((w) => w.id === work.id)
    onChange(exists ? works.map((w) => (w.id === work.id ? work : w)) : [...works, work])
  }
  function remove(id: string) {
    onChange(works.filter((w) => w.id !== id))
  }

  return (
    <div className="space-y-3">
      {works.length === 0 ? (
        <p className="text-sm text-muted">No opportunities added yet.</p>
      ) : (
        <div className="space-y-2">
          {works.map((w) => {
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
                  {valueLabel && <span className="shrink-0 font-mono text-[12px] text-ink-700">{valueLabel}</span>}
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
                    onClick={(e) => { e.stopPropagation(); remove(w.id) }}
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
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink-900">{value || '—'}</dd>
    </div>
  )
}
