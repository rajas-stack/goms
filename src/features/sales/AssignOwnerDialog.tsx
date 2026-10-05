import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Combobox } from '@/components/ui/Combobox'
import { useToast } from '@/components/ui/Toast'
import { useOwnershipMutations, useSalesPersons } from '@/lib/api'
import { isoToday } from '@/lib/dates'
import { salesPersonOption } from './salesPersonOption'

/** Assigns an owner or a delegate to one entity.
 *
 *  Delegation is deliberately the same dialog with a different role rather than
 *  a separate flow: in the data model it is one extra parallel row, and giving
 *  it its own screen would imply it replaces the owner, which it does not. */
export function AssignOwnerDialog({ open, entityType, entityId, entityLabel, onClose }: {
  open: boolean
  entityType: string
  entityId: string
  entityLabel: string
  onClose: () => void
}) {
  const toast = useToast()
  const { data: people = [] } = useSalesPersons()
  const { assign } = useOwnershipMutations()

  const [salesPersonId, setSalesPersonId] = useState('')
  const [role, setRole] = useState('owner')
  const [startDate, setStartDate] = useState(isoToday())
  const [endDate, setEndDate] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Reset per opening — a stale salesperson from the last entity would
  // otherwise be pre-filled and silently assigned to this one.
  useEffect(() => {
    if (!open) return
    setSalesPersonId('')
    setRole('owner')
    setStartDate(isoToday())
    setEndDate('')
    setNote('')
    setError(null)
  }, [open, entityId])

  async function submit() {
    setError(null)
    try {
      await assign.mutateAsync({
        entityType,
        entityId,
        salesPersonId,
        role,
        startDate,
        endDate: role === 'delegate' ? endDate : null,
        reason: role === 'delegate' ? 'delegation' : 'reassignment',
        note,
      })
      toast(role === 'delegate' ? 'Delegate added' : 'Owner assigned')
      onClose()
    } catch (e) {
      // The repository rejects invalid writes rather than warning, so surface
      // the reason instead of failing silently.
      setError(e instanceof Error ? e.message : 'Could not save the assignment.')
    }
  }

  const canSubmit = !!salesPersonId && !!startDate && (role !== 'delegate' || !!endDate)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={role === 'delegate' ? 'Add a delegate' : 'Assign owner'}
      description={entityLabel}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit || assign.isPending}>
            {assign.isPending ? 'Saving…' : role === 'delegate' ? 'Add delegate' : 'Assign'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Sales person" required>
          <Combobox
            value={salesPersonId}
            onChange={setSalesPersonId}
            options={people.map(salesPersonOption)}
            placeholder="Select…"
            aria-label="Sales person"
          />
        </Field>

        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="owner">Owner — replaces the current owner</option>
            <option value="delegate">Delegate — runs alongside, must expire</option>
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Effective from" required>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          {role === 'delegate' && (
            <Field label="Until" hint="A delegation must expire." required>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          )}
        </div>

        <Field label="Note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Why is this changing?" />
        </Field>

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
        )}
      </div>
    </Dialog>
  )
}
