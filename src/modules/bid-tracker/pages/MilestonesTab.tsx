import { useState } from 'react'
import { slugifyFieldKey } from '@goms/domain'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useBidMilestoneMutations, useBidMilestones } from '@/lib/api'
import type { BidMilestone } from '@/lib/types'

const field = 'h-8 w-full rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus-visible:focus-ring'

/** ISO instant → the local `YYYY-MM-DDTHH:mm` a datetime-local input wants. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

interface Draft { label: string; dueAt: string; venue: string; notes: string }
const draftOf = (m?: BidMilestone): Draft => ({ label: m?.label ?? '', dueAt: toLocalInput(m?.dueAt ?? null), venue: m?.venue ?? '', notes: m?.notes ?? '' })

function MilestoneForm({ draft, onChange, labelEditable }: { draft: Draft; onChange: (d: Draft) => void; labelEditable: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {labelEditable && (
        <label className="text-[12px] text-muted sm:col-span-2">Label
          <input aria-label="Label" className={field} value={draft.label} onChange={(e) => onChange({ ...draft, label: e.target.value })} />
        </label>
      )}
      <label className="text-[12px] text-muted">Date &amp; time
        <input aria-label="Date and time" type="datetime-local" className={field} value={draft.dueAt} onChange={(e) => onChange({ ...draft, dueAt: e.target.value })} />
      </label>
      <label className="text-[12px] text-muted">Venue
        <input aria-label="Venue" className={field} value={draft.venue} onChange={(e) => onChange({ ...draft, venue: e.target.value })} />
      </label>
      <label className="text-[12px] text-muted sm:col-span-2">Notes
        <textarea aria-label="Notes" rows={2} className={`${field} h-auto py-1`} value={draft.notes} onChange={(e) => onChange({ ...draft, notes: e.target.value })} />
      </label>
    </div>
  )
}

/** A bid's milestones: date, venue and notes, editable in place. The
 *  `submissionDeadline` slot is the bid's one system milestone — it can be
 *  edited (the API mirrors it to the opportunity and honours a frozen value)
 *  but never removed. Server rejections show inline on the row. */
export function MilestonesTab({ bidId }: { bidId: string }) {
  const { data: milestones = [], isLoading } = useBidMilestones(bidId)
  const { create, update, remove } = useBidMilestoneMutations(bidId)
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null)
  const [adding, setAdding] = useState<Draft | null>(null)
  const [error, setError] = useState<{ id: string; message: string } | null>(null)

  const run = async (id: string, action: () => Promise<unknown>) => {
    setError(null)
    try { await action() } catch (e) { setError({ id, message: e instanceof Error ? e.message : 'Could not save.' }); return false }
    return true
  }

  const sorted = [...milestones].sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || a.createdAt.localeCompare(b.createdAt))

  const saveEdit = async (m: BidMilestone) => {
    if (!editing) return
    const d = editing.draft
    const ok = await run(m.id, () => update.mutateAsync({
      id: m.id,
      patch: { ...(m.key === 'submissionDeadline' ? {} : { label: d.label.trim() || m.label }), dueAt: fromLocalInput(d.dueAt), venue: d.venue, notes: d.notes },
    }))
    if (ok) setEditing(null)
  }

  const saveNew = async () => {
    if (!adding || !adding.label.trim()) return
    const key = slugifyFieldKey(adding.label, new Set(milestones.map((m) => m.key)))
    const ok = await run('new', () => create.mutateAsync({
      bidId, milestoneType: key, key, label: adding.label.trim(), dueAt: fromLocalInput(adding.dueAt),
      venue: adding.venue || undefined, notes: adding.notes || undefined,
    }))
    if (ok) setAdding(null)
  }

  if (isLoading) return null
  return (
    <div className="space-y-3 p-4" data-testid="milestones-tab">
      {sorted.length === 0 && <p className="text-sm text-muted">No milestones yet.</p>}
      {sorted.map((m) => {
        const isEditing = editing?.id === m.id
        return (
          <div key={m.id} className="rounded-lg border border-line p-3" data-testid="milestone-card">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-medium text-ink">{m.label}</div>
              {m.status !== 'open' && <Badge tone="gray" className="capitalize">{m.status}</Badge>}
              {m.source === 'corrigendum' && <Badge tone="blue">Updated by corrigendum</Badge>}
              <div className="ml-auto flex items-center gap-1">
                {!isEditing && (
                  <>
                    <Button variant="ghost" size="sm" aria-label={`Edit ${m.label}`} onClick={() => { setError(null); setEditing({ id: m.id, draft: draftOf(m) }) }}>
                      <Icon name="Pencil" size={14} /> Edit
                    </Button>
                    {m.status !== 'superseded' && (
                      <Button
                        variant="ghost" size="sm" aria-label={m.status === 'completed' ? `Reopen ${m.label}` : `Mark ${m.label} complete`}
                        onClick={() => void run(m.id, () => update.mutateAsync({ id: m.id, patch: { status: m.status === 'completed' ? 'open' : 'completed' } }))}
                      >
                        <Icon name="Check" size={14} /> {m.status === 'completed' ? 'Reopen' : 'Complete'}
                      </Button>
                    )}
                    {m.key !== 'submissionDeadline' && (
                      <Button variant="ghost" size="icon" aria-label={`Delete ${m.label}`} onClick={() => { if (window.confirm(`Delete "${m.label}"?`)) void run(m.id, () => remove.mutateAsync(m.id)) }}>
                        <Icon name="Trash2" size={14} />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
            {isEditing ? (
              <div className="mt-2 space-y-2">
                <MilestoneForm draft={editing.draft} onChange={(draft) => setEditing({ id: m.id, draft })} labelEditable={m.key !== 'submissionDeadline'} />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={() => void saveEdit(m)}>Save</Button>
                </div>
              </div>
            ) : (
              <div className="mt-1 space-y-0.5">
                {m.dueAt ? <div className="text-sm">Date: {new Date(m.dueAt).toLocaleString()}</div> : <div className="text-sm text-muted">No record</div>}
                {m.venue && <div className="text-sm">Venue: {m.venue}</div>}
                {m.notes && <div className="text-sm italic text-muted">{m.notes}</div>}
              </div>
            )}
            {error?.id === m.id && <p role="alert" className="mt-2 text-[13px] text-crimson">{error.message}</p>}
          </div>
        )
      })}

      {adding ? (
        <div className="space-y-2 rounded-lg border border-dashed border-line p-3">
          <MilestoneForm draft={adding} onChange={setAdding} labelEditable />
          {error?.id === 'new' && <p role="alert" className="text-[13px] text-crimson">{error.message}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAdding(null)}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={!adding.label.trim()} onClick={() => void saveNew()}>Add milestone</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => { setError(null); setAdding(draftOf()) }}><Icon name="Plus" size={14} /> Add milestone</Button>
      )}
    </div>
  )
}
