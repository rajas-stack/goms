import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { useDepartments, useDirectReports, useEmployeeMutations, useTimeline, useTransfers } from '@/lib/api'
import { MERGEABLE_FIELDS, type MergeableField } from '@/data/repository'
import { cn } from '@/lib/utils'
import type { Employee } from '@/lib/types'

const FIELD_LABELS: Record<MergeableField, string> = {
  name: 'Name', designation: 'Designation', email: 'Email', phone: 'Phone',
  company: 'Company', address: 'Address', website: 'Website',
  relationshipStatus: 'Relationship status', relationshipQuality: 'Relationship quality',
  relationshipType: 'Relationship type', introducedBy: 'Introduced by', notes: 'Notes',
}

// Scalar fields counted toward "how complete is this record" when auto-
// picking which of the two survives — a superset of MERGEABLE_FIELDS, since
// e.g. `photoUrl`/dates can't conflict-resolve (no meaningful "which is
// right" choice) but still count as real, filled-in data.
const COMPLETENESS_FIELDS: (keyof Employee)[] = [
  'name', 'designation', 'email', 'phone', 'company', 'address', 'website',
  'relationshipType', 'introducedBy', 'notes', 'lastInteractionAt', 'followUpDate', 'photoUrl',
]

function completeness(e: Employee): number {
  let n = 0
  for (const f of COMPLETENESS_FIELDS) if (e[f]) n += 1
  if (e.preferredComm.length > 0) n += 1
  if (e.charges.length > 0) n += 1
  if (e.visitingCards.length > 0) n += 1
  return n
}

interface Relations { timeline: number; transfers: number; reports: number; isDeptHead: boolean }

// Linked relationships weigh more than a single filled-in field — losing a
// meeting history or a reporting line is a bigger deal than losing a blank
// "notes" field, so a record with fewer filled fields but more real
// relationships can still win the auto-pick.
function richness(r: Relations): number {
  return r.timeline + r.transfers * 2 + r.reports * 3 + (r.isDeptHead ? 5 : 0)
}

function relationCount(r: Relations): number {
  return r.timeline + r.transfers + r.reports
}

/** Hybrid merge flow: auto-picks which of the two records should survive
 *  (more complete data, more linked relationships, more recently touched),
 *  auto-fills empty survivor fields from the other record, and only asks the
 *  user to resolve fields where the two genuinely disagree — never a blind
 *  field-by-field comparison, never a silent auto-merge either. Nothing is
 *  written until "Merge contacts" is clicked. */
export function MergeEmployeesDialog({ open, onClose, employeeA, employeeB, onMerged }: {
  open: boolean
  onClose: () => void
  employeeA: Employee
  employeeB: Employee
  /** Called with the surviving record's id right after a successful merge —
   *  lets the caller redirect a selection that pointed at the removed record. */
  onMerged?: (survivorId: string) => void
}) {
  const toast = useToast()
  const { merge } = useEmployeeMutations()
  const { data: timelineA = [] } = useTimeline(employeeA.id)
  const { data: timelineB = [] } = useTimeline(employeeB.id)
  const { data: transfersA = [] } = useTransfers(employeeA.id)
  const { data: transfersB = [] } = useTransfers(employeeB.id)
  const { data: reportsA = [] } = useDirectReports(employeeA.id)
  const { data: reportsB = [] } = useDirectReports(employeeB.id)
  const { data: departments = [] } = useDepartments()

  const relationsA: Relations = {
    timeline: timelineA.length, transfers: transfersA.length, reports: reportsA.length,
    isDeptHead: departments.some((d) => d.metadata.deptHead === employeeA.id),
  }
  const relationsB: Relations = {
    timeline: timelineB.length, transfers: transfersB.length, reports: reportsB.length,
    isDeptHead: departments.some((d) => d.metadata.deptHead === employeeB.id),
  }

  const scoreA = completeness(employeeA) + richness(relationsA) * 2
  const scoreB = completeness(employeeB) + richness(relationsB) * 2
  const autoSurvivorId = scoreA === scoreB
    ? (employeeA.connected !== employeeB.connected ? (employeeA.connected ? employeeA.id : employeeB.id) : employeeA.id)
    : (scoreA > scoreB ? employeeA.id : employeeB.id)

  const [survivorId, setSurvivorId] = useState(autoSurvivorId)
  const [resolutions, setResolutions] = useState<Partial<Record<MergeableField, string>>>({})

  // Re-seed the auto-pick and any prior conflict resolutions whenever the
  // dialog opens fresh for a (possibly different) pair.
  useEffect(() => {
    if (open) {
      setSurvivorId(autoSurvivorId)
      setResolutions({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employeeA.id, employeeB.id])

  const survivor = survivorId === employeeA.id ? employeeA : employeeB
  const other = survivorId === employeeA.id ? employeeB : employeeA
  const otherRelations = survivorId === employeeA.id ? relationsB : relationsA

  const conflicts = useMemo(
    () => MERGEABLE_FIELDS.filter((f) => survivor[f] && other[f] && survivor[f] !== other[f]),
    [survivor, other],
  )
  const autoFills = useMemo(
    () => MERGEABLE_FIELDS.filter((f) => !survivor[f] && other[f]),
    [survivor, other],
  )

  function pick(field: MergeableField, value: string) {
    setResolutions((r) => {
      if (value === String(survivor[field])) {
        const next = { ...r }
        delete next[field]
        return next
      }
      return { ...r, [field]: value }
    })
  }

  async function confirmMerge() {
    // `resolutions` is keyed the same as `MergeableField` and every value was
    // read straight off one of the two real `Employee` records, so it's a
    // valid `Partial<Pick<Employee, MergeableField>>` at runtime — the string
    // typing above only exists because this component's UI treats every
    // field as freeform text for display/comparison.
    const result = await merge.mutateAsync({
      survivorId: survivor.id, duplicateId: other.id,
      resolutions: resolutions as Partial<Pick<Employee, MergeableField>>,
    })
    toast(`Merged "${other.name}" into "${survivor.name}"`)
    onMerged?.(result.survivor.id)
    onClose()
  }

  const transferLines = [
    otherRelations.timeline > 0 && `${otherRelations.timeline} timeline ${otherRelations.timeline === 1 ? 'entry' : 'entries'}`,
    otherRelations.transfers > 0 && `${otherRelations.transfers} transfer${otherRelations.transfers === 1 ? '' : 's'}`,
    otherRelations.reports > 0 && `${otherRelations.reports} direct report${otherRelations.reports === 1 ? '' : 's'}`,
    otherRelations.isDeptHead && 'department headship',
    other.visitingCards.length > 0 && `${other.visitingCards.length} visiting card${other.visitingCards.length === 1 ? '' : 's'}`,
    other.charges.length > 0 && `${other.charges.length} charge${other.charges.length === 1 ? '' : 's'}`,
  ].filter((v): v is string => !!v)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Merge duplicate contacts"
      description={`${employeeA.name || 'Unnamed'} + ${employeeB.name || 'Unnamed'}`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={merge.isPending}>Cancel</Button>
          <Button variant="primary" onClick={confirmMerge} disabled={merge.isPending}>
            <Icon name="GitMerge" size={14} /> {merge.isPending ? 'Merging…' : 'Merge contacts'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink-800">Keep as the primary record</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[employeeA, employeeB].map((e) => {
              const rel = e.id === employeeA.id ? relationsA : relationsB
              const linked = relationCount(rel)
              return (
                <label
                  key={e.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 transition-colors',
                    survivorId === e.id ? 'border-ink-600 bg-panel/60' : 'border-line bg-white hover:border-ink-600/40',
                  )}
                >
                  <input
                    type="radio"
                    name="survivor"
                    checked={survivorId === e.id}
                    onChange={() => setSurvivorId(e.id)}
                    className="mt-1 accent-ink-900"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-ink-900">{e.name || 'Unnamed'}</span>
                      {e.id === autoSurvivorId && (
                        <span className="shrink-0 rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">Suggested</span>
                      )}
                    </span>
                    <span className="block text-[12px] text-muted">{e.designation || '—'}</span>
                    <span className="mt-1 block text-[11px] text-muted">
                      {completeness(e)} fields filled · {linked} linked record{linked === 1 ? '' : 's'}{rel.isDeptHead ? ' · department head' : ''}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        {conflicts.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-ink-800">These fields differ — pick which value to keep</p>
            <div className="space-y-3">
              {conflicts.map((field) => {
                const survivorValue = String(survivor[field])
                const chosen = resolutions[field] ?? survivorValue
                return (
                  <div key={field} className="rounded-xl border border-amber-600/40 bg-amber-100/30 p-3">
                    <p className="mb-1.5 text-[12px] font-semibold text-ink-800">{FIELD_LABELS[field]}</p>
                    <div className="space-y-1.5">
                      {[survivor, other].map((e) => (
                        <label key={e.id} className="flex cursor-pointer items-start gap-2">
                          <input
                            type="radio"
                            name={`field-${field}`}
                            checked={chosen === String(e[field])}
                            onChange={() => pick(field, String(e[field]))}
                            className="mt-0.5 accent-ink-900"
                          />
                          <span className="min-w-0 flex-1 break-words text-[13px] text-ink-800">
                            {String(e[field])}
                            <span className="ml-1.5 text-[11px] text-muted">({e.id === survivor.id ? 'primary' : 'other'} record)</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {autoFills.length > 0 && (
          <p className="text-[12px] text-muted">
            Will auto-fill on the primary record from the other: {autoFills.map((f) => FIELD_LABELS[f]).join(', ')}.
          </p>
        )}

        <div className="rounded-xl border border-line bg-panel/40 p-3">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-800">This will also transfer onto the primary record</p>
          {transferLines.length === 0 ? (
            <p className="text-[12px] text-muted">Nothing else to transfer — the other record has no linked timeline, transfers, reports, or attachments.</p>
          ) : (
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-ink-700">
              {transferLines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted">
            "{other.name || 'The other record'}" will be deleted once merged. This is recorded in a permanent merge history for later review.
          </p>
        </div>
      </div>
    </Dialog>
  )
}
